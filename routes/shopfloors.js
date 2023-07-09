import express from 'express'
import multer from 'multer';
import path from 'path'
import pool from '../db.js'

const router = express.Router()

/**
 * Get list of shopfloors
 */
router.get('/', async (req, res) => {
    const [shopfloors] = await pool.execute(`SELECT id, name, created_at FROM shopfloors WHERE deleted_at IS NULL`);

    return res.send(shopfloors);
});

/**
 * Get shopfloor by its id, including its cells or not options (given in request url query)
 */
router.get('/:id', async (req, res) => {
    const id = req.params['id'];

    const [shopfloors] = await pool.execute(`SELECT id, NOW() time, name, length, width, map_url, created_at FROM shopfloors WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (shopfloors.length == 0) {
        return res.status(404).send('shopfloor with the given id was not found')
    }
    const shopfloor = shopfloors[0]

    // Calculate the shopfloor flow time
    shopfloor.average_flow_time = await getShopfloorAverageFlowTime(id)

    // Get the shopfloor's cells
    if (req.query['cells'] != null) {
        if (req.query['active-work-orders'] != null) {      // If including cells' active work orders
            shopfloor.cells = await getCellsAndActiveWorkOrders(id);
        } else {    // If not including cells' active work orders
            const [cells] = await pool.execute(`SELECT * FROM cells WHERE shopfloor_id = ? AND deleted_at IS NULL`, [id]);
            shopfloor.cells = cells;
        }
    }

    return res.send(shopfloor);
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)) //Appending extension
    }
})
const upload = multer({ storage: storage });
/**
 * Post a new shopfloor
 */
router.post('/', upload.single('shopfloor-map'), async (req, res) => {
    const name = req.body['name'];
    const length = parseFloat(req.body['length']);
    const width = parseFloat(req.body['width']);
    const map_url = req.file.filename;
    const req_cells = req.body['cells'].map((el) => {
        return JSON.parse(decodeURIComponent(el));
    });
    
    // Check nodemcu_code for conflict (must be unique)
    for (const req_cell of req_cells) {
        const [cells] = await pool.execute(`SELECT id FROM cells WHERE nodemcu_code = ?`, [req_cell.nodemcu_code])
        if (cells.length > 0) {
            return res.status(409).send(`Failed! nodemcu_code ${req_cell.nodemcu_code} already exists`)
        }
    }

    let [shopfloor] = await pool.execute(`INSERT INTO shopfloors(name, length, width, map_url) VALUES(?, ?, ?, ?)`,
                                                                    [name, length, width, map_url]);
    let [shopfloors] = await pool.execute(`SELECT * FROM shopfloors WHERE id = ?`, [shopfloor.insertId]);
    shopfloor = shopfloors[0];


    req_cells.forEach(async (cell) => {
        const [inserted] = await pool.execute(`INSERT INTO cells(nodemcu_code, name, radius, shopfloor_id, relative_position_x, relative_position_y) VALUES(?, ?, ?, ?, ?, ?)`,
                                                [cell.nodemcu_code, cell.name, cell.radius, shopfloor.id, cell.relative_position_x, cell.relative_position_y]);
    });
    const [cells] = await pool.execute(`SELECT * FROM cells WHERE shopfloor_id = ?`, [shopfloor.id]);
    shopfloor.cells = cells;

    return res.redirect(`${req.get('origin')}/shopfloors`);
});

/**
 * PUT: update a shopfloor
 */
router.put('/:id', upload.single('shopfloor-map'), async (req, res) => {
    const name = req.body['name'];
    const length = parseFloat(req.body['length']);
    const width = parseFloat(req.body['width']);
    const req_cells = req.body['cells'].map((el) => {
        return JSON.parse(decodeURIComponent(el));
    });

    // Check if shopfloor with the given id exists
    const [shopfloors] = await pool.execute(`SELECT * FROM shopfloors WHERE id = ?`, [req.params.id])
    if (shopfloors.length == 0) {
        return res.status(404).send('shopfloor with the given id was not found')
    }
    const shopfloor = shopfloors[0]

    // Check nodemcu_code for conflict (must be unique)
    for (const c of req_cells) {
        const [cells] = await pool.execute(`SELECT id FROM cells WHERE shopfloor_id != ? AND nodemcu_code = ?`, [shopfloor.id, c.nodemcu_code])
        if (cells.length > 0) {
            return res.status(409).send(`Failed! nodemcu_code ${c.nodemcu_code} already exists`)
        }
    }

    // Update the shopfloor
    if (req.file) {
        const [shopfloorUpdate] = await pool.execute(`UPDATE shopfloors SET name = ?, length = ?, width = ?, map_url = ? WHERE id = ?`,
                                                        [name, length, width, req.file.filename, req.params.id])
    } else {
        const [shopfloorUpdate] = await pool.execute(`UPDATE shopfloors SET name = ?, length = ?, width = ? WHERE id = ?`,
                                                        [name, length, width, req.params.id])
    }
    
    // Get the shopfloor's cells
    const [current_cells] = await pool.execute(`SELECT * FROM cells WHERE shopfloor_id = ?`, [shopfloor.id])

    // Delete deleted cells (cell tidak ada lagi di request client)
    for (const current_cell of current_cells) {
        const found = req_cells.find((req_cell) => current_cell.id == req_cell.id)
        if (!found) {
            await pool.execute(`UPDATE cells SET nodemcu_code = CONCAT(nodemcu_code, CONCAT('_deleted ', NOW())), deleted_at = NOW() WHERE id = ?`, [current_cell.id])
        }
    }

    // Update (or insert if not exists) each cell
    /// First, update each shopfloor's cells nodemcu_code to NULL first to avoid conflicting codes
    await pool.execute(`UPDATE cells SET nodemcu_code = NULL WHERE shopfloor_id = ? AND deleted_at IS NULL`, [shopfloor.id])    
    for (const c of req_cells) {
        const [cellUpdate] = await pool.execute(`UPDATE cells SET nodemcu_code = ?, name = ?, radius = ?, relative_position_x = ?, relative_position_y = ? WHERE id = ?`, 
                                                [c.nodemcu_code, c.name, c.radius, c.relative_position_x, c.relative_position_y, c.id])
        if (cellUpdate.affectedRows == 0) {
            const [cellInsert] = await pool.execute(`INSERT INTO cells(nodemcu_code, name, radius, shopfloor_id, relative_position_x, relative_position_y) VALUES(?, ?, ?, ?, ?, ?)`,
                                                [c.nodemcu_code, c.name, c.radius, shopfloor.id, c.relative_position_x, c.relative_position_y])
        }
    }

    return res.redirect(`${req.get('origin')}/shopfloors`);
})

router.delete('/:id', async (req, res) => {
    const id = req.params.id
    await pool.execute(`UPDATE shopfloors SET deleted_at = NOW() WHERE id = ?`, [id])
    await pool.execute(`UPDATE cells SET nodemcu_code = CONCAT(nodemcu_code, CONCAT('_deleted ', NOW())), deleted_at = NOW() WHERE shopfloor_id = ?`, [id])
    return res.send({
        id
    })
})

async function getShopfloorAverageFlowTime(shopfloor_id) {
    let query = `SELECT AVG(TIMESTAMPDIFF(SECOND, wo.created_at, wo.ended_at)) * 1000 shopfloor_average_flow_time
                    FROM work_orders wo
                    INNER JOIN work_orders_tags wot ON wot.work_order_id = wo.id
                    INNER JOIN (SELECT DISTINCT wot.id id
                                FROM work_orders_tags wot
                                INNER JOIN work_orders wo ON wot.work_order_id = wo.id
                                INNER JOIN cells_work_orders_tags cwot ON cwot.work_order_tag_id = wot.id
                                INNER JOIN cells c ON cwot.cell_id = c.id
                                WHERE wo.ended_at IS NOT NULL AND c.shopfloor_id = ?) swot
                    ON wot.id = swot.id`
    const [safts] = await pool.execute(query, [shopfloor_id])
    if (safts.length > 0) {
        return safts[0].shopfloor_average_flow_time
    } else {
        return 0
    }
}

async function getCellsAndActiveWorkOrders(shopfloor_id) {
    let query = `SELECT c.id cell_id, c.nodemcu_code cell_nodemcu_code, c.name cell_name, c.radius cell_radius,
                        c.relative_position_x cell_relative_position_x, c.relative_position_y cell_relative_position_y,
                        wo.jid jid, t.epc_code epc_code, wo.created_at created_at, cwot.entered_at entered_at
                        FROM cells c
                        LEFT OUTER JOIN (SELECT * FROM cells_work_orders_tags WHERE moved_at IS NULL) cwot ON cwot.cell_id = c.id
                        LEFT OUTER JOIN work_orders_tags wot ON cwot.work_order_tag_id = wot.id
                        LEFT OUTER JOIN work_orders wo ON wo.id = wot.work_order_id
                        LEFT OUTER JOIN tags t ON t.id = wot.tag_id
                        WHERE c.shopfloor_id = ? AND c.deleted_at IS NULL
                        ORDER BY c.id ASC, cwot.entered_at ASC, cwot.work_order_tag_id ASC`
    const [rows] = await pool.execute(query, [shopfloor_id])
    
    // Marshalling
    const cells = []
    let last_cell_id = -1
    let current_cell = {}
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row['cell_id'] == last_cell_id) {
            if (row['jid'] != null) {
                current_cell.work_orders.push({
                    jid: row['jid'],
                    epc_code: row['epc_code'],
                    created_at: row['created_at'],
                    entered_at: row['entered_at']
                })
            }
        } else {
            last_cell_id = row['cell_id']
            current_cell = {
                id: row['cell_id'],
                nodemcu_code: row['cell_nodemcu_code'],
                name: row['cell_name'],
                radius: row['cell_radius'],
                relative_position_x: row['cell_relative_position_x'],
                relative_position_y: row['cell_relative_position_y'],
                work_orders: []
            }
            cells.push(current_cell)
            if (row['jid'] != null) {
                current_cell.work_orders.push({
                    jid: row['jid'],
                    epc_code: row['epc_code'],
                    created_at: row['created_at'],
                    entered_at: row['entered_at']
                })
            }
        }
    }

    return cells
}

export default router
