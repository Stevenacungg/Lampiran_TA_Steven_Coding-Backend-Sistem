import pool from "../db.js"

async function updateCellDetectedWorkOrdersByNodemcuCode(nodemcu_code, epcCodes) {
    const [cells] = await pool.execute('SELECT * FROM cells WHERE nodemcu_code = ?', [nodemcu_code])
    if (cells.length == 0) {
        return
    }

    const cell = cells[0]
    const result = await updateCellDetectedWorkOrders(cell.id, epcCodes)
    return
}

async function updateCellDetectedWorkOrders(cell_id, epcCodes) {
  // sanitize epcCodes: remove duplicates
  epcCodes = [...new Set(epcCodes)]

  // attributes: id, epc_code, cell_id
  const [cwots] = await pool.execute(`SELECT cwot.id id, t.epc_code epc_code, cwot.cell_id cell_id
                                          FROM cells_work_orders_tags cwot
                                              INNER JOIN work_orders_tags wot ON cwot.work_order_tag_id = wot.id
                                              INNER JOIN tags t ON wot.tag_id = t.id
                                          WHERE cwot.moved_at IS NULL`, [cell_id])
  
  // Condition for newly detected epc codes
  for (const epcCode of epcCodes) {
      const found = cwots.find((value) => {     // find the given epc code in the cell's work orders
          return value.epc_code == epcCode
      })

      if (found) {  // If the work order is active, just ignore

      } else {     // If the given epc code not in active work orders,
                    // get the last position of the work order
                    // If it is the same, do not add new movement history, but only update moved_at to null
        const [wots] = await pool.execute(`SELECT t.epc_code, wot.id work_order_tag_id, cwot.cell_id cell_id, cwot.id cell_work_order_tag_id
                                            FROM tags t
                                            LEFT OUTER JOIN work_orders_tags wot ON wot.tag_id = t.id
                                            LEFT OUTER JOIN work_orders wo ON wot.work_order_id = wo.id
                                            LEFT OUTER JOIN cells_work_orders_tags cwot ON cwot.work_order_tag_id = wot.id
                                            WHERE t.epc_code = ? AND wo.ended_at IS NULL
                                            ORDER BY cwot.moved_at DESC`,
                                            [epcCode])

        if (wots.length > 0 && wots[0].work_order_tag_id != null) { // if epc code found and currently associated with an active work order
            const wot = wots[0]
            if (wot.cell_work_order_tag_id == null || wot.cell_id != cell_id) {  // no movement yet for this work order or different cell than last position
                await pool.execute(`INSERT INTO cells_work_orders_tags(cell_id, work_order_tag_id) VALUES(?, ?)`, [cell_id, wot.work_order_tag_id])
            } else {                                                        // else (if last position is same) just update to moved_at to null    
                await pool.execute(`UPDATE cells_work_orders_tags SET moved_at = NULL WHERE id = ?`, [wot.cell_work_order_tag_id])
            }
        }
      }
  }

  // Condition for work orders that expired (no longer detected)
  for (const cwot of cwots) {
    if (cwot.cell_id != cell_id) {
        continue
    }

    const found = epcCodes.find((value) => {
        return value == cwot.epc_code
    })
    if (!found) {   // if a work order no longer detected, delete it (set moved_at to non-null)
        await pool.execute(`UPDATE cells_work_orders_tags SET moved_at = NOW() WHERE id = ?`, [cwot.id])
    }
  }
}

export { updateCellDetectedWorkOrders, updateCellDetectedWorkOrdersByNodemcuCode }
