import express from 'express'
import pool from '../db.js';
import { updateCellDetectedWorkOrders } from '../methods/cells.js';

const router = express.Router()

/**
 * By cell's nodemcu_code, post detected work orders of a cell (alternative to update by MQTT subscription)
 */
router.post('/detected-work-orders', async (req, res) => {
    const nodemcu_code = req.body.nodemcu_code
    const epcCodes = req.body.epc_codes
    if (!nodemcu_code)  {
        return res.status(400).send('nodemcu_code must be provided')
    }
    if (!epcCodes) {
        return res.status(400).send('epc_codes must be provided')
    }

    const [cells] = await pool.execute('SELECT * FROM cells WHERE nodemcu_code = ?', [nodemcu_code])
    if (cells.length == 0) {
        return res.status(404).send('cell with the given nodemcu_code was not found')
    }
    
    const cell = cells[0]
    const result = await updateCellDetectedWorkOrders(cell.id, epcCodes)
    res.send('success')
})

/**
 * By cell's id, post detected work orders of a cell (alternative to update by MQTT subscription)
 */
router.post('/:id/detected-work-orders', async (req, res) => {
    const epcCodes = req.body.epc_codes
    if (!epcCodes) {
        return res.status(400).send('epc_codes must be provided')
    }

    const result = await updateCellDetectedWorkOrders(req.params.id, epcCodes)
    res.send('success')
});

/**
 * Check if nodemcu codes already used
 */
router.post('/check-nodemcu-codes', async (req, res) => {
    if (!req.body.nodemcu_codes) {
        return res.send({ used_nodemcu_codes: [] })
    }

    // Get nodemcu_code that already exists
    const used_nodemcu_codes = []
    for (const nodemcu_code of req.body.nodemcu_codes) {
        let cells = []
        if (req.query['ignore-shopfloor-id']) {
            [cells] = await pool.execute(`SELECT id FROM cells WHERE nodemcu_code = ? AND shopfloor_id != ?`, [nodemcu_code, req.query['ignore-shopfloor-id']])
        } else {
            [cells] = await pool.execute(`SELECT id FROM cells WHERE nodemcu_code = ?`, [nodemcu_code])
        }
        
        if (cells.length > 0) {
            used_nodemcu_codes.push(nodemcu_code)
        }
    }

    return res.send({ used_nodemcu_codes: used_nodemcu_codes })
})

export default router
