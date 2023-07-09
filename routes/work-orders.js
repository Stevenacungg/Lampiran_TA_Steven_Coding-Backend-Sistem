import express from 'express'
import pool from '../db.js'
import auth from '../middlewares/auth.js';

const router = express.Router()
let scannedEpcCode = ''     // scanned epc code from reader

/**
 * Find a work order and its history by jid
 */
router.get('/', async (req, res) => {
    if (req.query['jid']) {
        const jid = req.query['jid'];
        const [wos] = await pool.execute(`SELECT NOW() time, wo.id work_order_id, t.id tag_id, wot.id work_order_tag_id, wo.jid jid, t.epc_code epc_code, wo.created_at created_at, wo.ended_at ended_at
                                            FROM work_orders wo
                                            INNER JOIN work_orders_tags wot ON wot.work_order_id = wo.id
                                            INNER JOIN tags t ON wot.tag_id = t.id
                                            WHERE wo.jid = ?`, [jid]);
        if (wos.length == 0) {
            return res.status(404).send('work order with the given jid was not found');
        }

        // Get work order tracking history
        const wo = wos[0];
        const [cells] = await pool.execute(`SELECT c.id id, c.name name, c.nodemcu_code nodemcu_code, c.shopfloor_id shopfloor_id, cwot.entered_at entered_at, cwot.moved_at moved_at
                                                    FROM cells_work_orders_tags cwot
                                                    INNER JOIN cells c ON cwot.cell_id = c.id
                                                    WHERE work_order_tag_id = ? ORDER BY entered_at ASC`, [wo.work_order_tag_id])
        wo.cells = cells

        // Get work order shopfloor position
        if (cells.length > 0) {
            const cell = cells[0]
            const [shopfloors] = await pool.execute(`SELECT id, name FROM shopfloors WHERE id = ?`, [cell.shopfloor_id])
            if (shopfloors.length > 0) {
                const s = shopfloors[0]
                wo.shopfloor_id = s.id
                wo.shopfloor_name = s.name
            }
        }

        return res.send(wo);
    }

    return res.send([]);
});


/**
 * Post a new work order. Need to be authenticated.
 */
router.post('/', auth, async (req, res) => {
    const jid = req.body.jid;
    const epc_code = req.body.epc_code;
    if (!jid) {
        return res.status(400).send('jid is required');
    }
    if (!epc_code) {
        return res.status(400).send('epc_code is required');
    }

    // Additional check if jid is used
    const [wos] = await pool.execute(`SELECT jid FROM work_orders WHERE jid = ?`, [jid]);
    if (wos.length > 0) {
        return res.status(409).send('jid is already used');
    }

    // Additional check if epc_code is used by ongoing work orders
    const [rows] = await pool.execute(`SELECT cwot.id cwot_id, wo.id work_order_id, t.id tag_id, cwot.moved_at moved_at
                        FROM tags t
                        LEFT OUTER JOIN work_orders_tags wot ON wot.tag_id = t.id
                        LEFT OUTER JOIN work_orders wo ON wot.work_order_id = wo.id
                        LEFT OUTER JOIN cells_work_orders_tags cwot ON cwot.work_order_tag_id = wot.id
                        WHERE t.epc_code = ? AND wo.ended_at IS NULL
                        ORDER BY cwot.moved_at IS NULL DESC, cwot.entered_at DESC`, [epc_code])
    
    let tag_id = null
    if (rows.length > 0) {              // If epc code already inserted to tags table
        const row = rows[0]
        if (row.cwot_id == null) {          // If work order exists but not yet detected (no cwot entry)
            return res.status(409).send('epc_code is already used by an ongoing work order')
        } else if (row.moved_at == null) {  // If work order exists and ongoing (moved_at is null)
            return res.status(409).send('epc_code is already used by an ongoing work order')
        } else {                            // If work order exists but no longer detected
            await pool.execute(`UPDATE work_orders SET ended_at = NOW() WHERE id = ?`, [row.work_order_id])
            tag_id = row.tag_id
        }
    } else {                            // If epc code not yet in tags table
        const [t] = await pool.execute(`INSERT INTO tags(epc_code) VALUES(?)`, [epc_code]);
        tag_id = t.insertId
    }

    // Insert new work order
    const [wo] = await pool.execute(`INSERT INTO work_orders(jid) VALUES(?)`, [jid]);
    const [wot] = await pool.execute(`INSERT INTO work_orders_tags(work_order_id, tag_id) VALUES(?, ?)`, [wo.insertId, tag_id]);
    const result = {
        work_order_tag_id: wot.insertId,
        work_order_id: wo.insertId,
        tag_id: tag_id,
        jid: jid,
        epc_code: epc_code
    };
    
    scannedEpcCode = ''     // Reset scannedEpcCode
    return res.send(result)
});

router.post('/finish', auth, async (req, res) => {
    const jid = req.body.jid
    if (!jid) {
        return res.status(400).send('jid must be provided')
    }

    const [wos] = await pool.execute(`SELECT wo.id id, wo.created_at created_at, wo.ended_at ended_at, cwot.entered_at entered_at, cwot.moved_at moved_at
                                    FROM work_orders wo
                                    LEFT OUTER JOIN work_orders_tags wot ON wot.work_order_id = wo.id
                                    LEFT OUTER JOIN cells_work_orders_tags cwot ON cwot.work_order_tag_id = wot.id
                                    WHERE wo.jid = ? ORDER BY cwot.entered_at DESC`, [jid])
    if (wos.length == 0) {
        return res.status(404).send('work order dengan jid tersebut tidak ditemukan')
    }

    const wo = wos[0]
    if (wo.ended_at != null) {
        return res.status(409).send('work order dengan jid tersebut telah selesai')
    } else if (wo.moved_at == null) {
        if (wo.entered_at == null) {
            return res.status(409).send('work order dengan jid tersebut masih di entry/exit')
        } else {
            return res.status(409).send('work order dengan jid tersebut masih terdeteksi di cell')
        }
    } else {
        await pool.execute(`UPDATE work_orders SET ended_at = NOW() WHERE jid = ?`, [jid])
        return res.send('work order dengan jid tersebut berhasil diselesaikan')
    }

})


///// EPC Code from Reader /////
/**
 * Get scanned epc code
 */
router.get('/scanned-epc-code', (req, res) => {
    return res.send({ epc_code: scannedEpcCode })
})

/**
 * Post scanned epc code (from reader)
 */
router.post('/scanned-epc-code', (req, res) => {
    // Split epc-codes-string to list of epc codes by the reader delimiter
    const line_ending = req.body.line_ending
    const field_delim = req.body.field_delim
    const field_values = req.body.field_values.split(line_ending)
    const epcCodes = field_values.map((row) => {
        const arr = row.split(field_delim)
        return arr[0]
    })

    // Update scannedEpcCode
    if (epcCodes.length == 0) {
        scannedEpcCode = ''
    } else {
        scannedEpcCode = epcCodes[0]
    }

    return res.send({ epc_code: scannedEpcCode })
})


////// Statistics //////
/**
 * Get recap of finished work orders (jid, duration in shopfloor)
 */
router.post('/recap', async (req, res) => {
    const order = req.body.order
    const start = parseInt(req.body.start)
    const length = parseInt(req.body.length)
    const search = req.body.search.value

    // Count of finished work orders
    const [workOrdersCount] = await pool.execute(`SELECT COUNT(id) count FROM work_orders wo WHERE wo.ended_at IS NOT NULL`)
    const recordsTotal = workOrdersCount[0].count

    // Count of finished work orders that match searching criteria (not limited by pagination)
    const [filteredWorkOrdersCount] = await pool.execute(`SELECT COUNT(DISTINCT jid) count
                                                            FROM work_orders wo
                                                            WHERE wo.jid LIKE ? AND wo.ended_at IS NOT NULL`, [`${search}%`])
    const recordsFiltered = filteredWorkOrdersCount[0].count

    const orderBy = {
        column: order[0].column == '0' ? 'jid' : 'durationInShopfloor',
        dir: order[0].dir
    }
    
    // Finished work orders matching criteria (limited by pagination)
    let sql = pool.format(`SELECT jid, TIMESTAMPDIFF(SECOND, wo.created_at, wo.ended_at) * 1000 durationInShopfloor, jid
                            FROM work_orders wo
                            WHERE jid LIKE ? AND wo.ended_at IS NOT NULL
                            ORDER BY ?? ? LIMIT ?,?`, [`${search}%`, orderBy.column, orderBy.dir, start, length])
    sql = sql.replace("'asc'", 'asc').replace("'desc'", 'desc')
    const [filteredWorkOrders] = await pool.execute(sql)

    return res.send({
        draw: parseInt(req.body.draw),
        recordsTotal,
        recordsFiltered,
        data: filteredWorkOrders
    })
})

/**
 * Get work order count details of a month
 */
router.get('/monthly-daily-count-detail', async (req, res) => {
    const year = parseInt(req.query['year'])
    const month = parseInt(req.query['month'])
    const lastDay = parseInt(req.query['last-day'])
    if (!month || !year || !lastDay) {
        return res.status(400).send('year, month, and last-day query parameters must be provided')
    }

    const query_created = `WITH RECURSIVE days AS (
                                SELECT 1 day
                                UNION ALL
                                SELECT days.day + 1 FROM days WHERE days.day < 31
                            )
                            SELECT d.day day, count(wo.id) count
                            FROM days d
                            LEFT OUTER JOIN (SELECT * FROM work_orders WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?) wo
                                ON DAY(wo.created_at) = d.day
                            WHERE d.day <= ?
                            GROUP BY d.day ORDER BY d.day ASC`
    
    const query_ended = `WITH RECURSIVE days AS (
                                SELECT 1 day
                                UNION ALL
                                SELECT days.day + 1 FROM days WHERE days.day < 31
                            )
                            SELECT d.day day, count(wo.id) count
                            FROM days d
                            LEFT OUTER JOIN (SELECT * FROM work_orders WHERE YEAR(ended_at) = ? AND MONTH(ended_at) = ?) wo
                                ON DAY(wo.ended_at) = d.day
                            WHERE d.day <= ?
                            GROUP BY d.day ORDER BY d.day ASC`
    
    const query_total_unparsed = `SELECT wo.id id, wo.created_at created_at, wo.ended_at ended_at
                                    FROM work_orders wo
                                    WHERE (wo.ended_at >= ? OR wo.ended_at IS NULL) AND wo.created_at <= ?
                                    ORDER BY wo.created_at ASC`

    const [created] = await pool.execute(query_created, [year, month, lastDay])
    const [ended] = await pool.execute(query_ended, [year, month, lastDay])
    const [total_unparsed] = await pool.execute(query_total_unparsed, [`${year}-${month.toString().padStart(2, '0')}-01`, `${year}-${month.toString().padStart(2, '0')}-31`])
    
    // Processing the total_unparsed
    const total = []
    const firstDate = new Date(`${year}-${month.toString().padStart(2, '0')}-01`)
    const lastDate = new Date(`${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`)
    for(let i = 0; i < lastDate.getDate(); i++) {
        total.push({ day: i+1, count: 0 })
    }
    for(const wo of total_unparsed) {
        const createDate = new Date(wo.created_at)
        const beginDate = new Date(Math.max(createDate, firstDate))

        const endDate = wo.ended_at ? new Date(Math.min(new Date(wo.ended_at), lastDate)) : lastDate
        
        let beginDay = beginDate.getDate()
        let endDay = endDate.getDate()
        while (beginDay <= endDay) {
            total[beginDay-1].count++

            beginDay++
        }
    }

    return res.send({
        month,
        year,
        last_day: lastDay,
        data: {
            created, ended, total
        }
    })                  
})

/**
 * Get flowtime detail of a month
 */
router.get('/monthly-daily-flowtime-detail', async (req, res) => {
    const year = parseInt(req.query['year'])
    const month = parseInt(req.query['month'])
    const lastDay = parseInt(req.query['last-day'])
    if (!month || !year || !lastDay) {
        return res.status(400).send('year, month, and last-day query parameters must be provided')
    }

    const query_flowtime =  `WITH RECURSIVE days AS (
                                SELECT 1 day
                                UNION ALL
                                SELECT days.day + 1 FROM days WHERE days.day < 31
                            )
                            SELECT d.day day, IFNULL(AVG(TIMESTAMPDIFF(SECOND, wo.created_at, wo.ended_at)) * 1000, 0) flowtime
                            FROM days d
                            LEFT OUTER JOIN (SELECT * FROM work_orders WHERE YEAR(ended_at) = ? AND MONTH(ended_at) = ?) wo
                                ON DAY(wo.ended_at) = d.day
                            WHERE d.day <= ?
                            GROUP BY d.day ORDER BY d.day ASC`
    const [flowtime] = await pool.execute(query_flowtime, [year, month, lastDay])

    return res.send({
        month,
        year,
        last_day: lastDay,
        data: {
            flowtime
        }
    })
})

export default router
