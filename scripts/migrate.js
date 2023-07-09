import pool from "../db.js";

initTables()

async function initTables() {
    console.log('Creating Tables...');

    await pool.execute(`CREATE TABLE users(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            username VARCHAR(255) UNIQUE NOT NULL,
                            name VARCHAR(255) NOT NULL,
                            password VARCHAR(255) NOT NULL,
                            role ENUM('admin', 'worker', 'entry-exit') NOT NULL,
                            created_at TIMESTAMP DEFAULT NOW()
                      )`);
  
    await pool.execute(`CREATE TABLE shopfloors(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            name VARCHAR(255) NOT NULL,
                            length FLOAT NOT NULL,
                            width FLOAT NOT NULL,
                            map_url VARCHAR(1023) NOT NULL,
                            created_at TIMESTAMP DEFAULT NOW(),
                            deleted_at TIMESTAMP NULL DEFAULT NULL
                        )`);
  
    await pool.execute(`CREATE TABLE cells(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            nodemcu_code VARCHAR(255) UNIQUE,
                            name VARCHAR(255) NOT NULL,
                            shopfloor_id INT,
                            radius FLOAT NOT NULL,
                            relative_position_x FLOAT,
                            relative_position_y FLOAT,
                            created_at TIMESTAMP DEFAULT NOW(),
                            deleted_at TIMESTAMP NULL DEFAULT NULL,
                            FOREIGN KEY(shopfloor_id) REFERENCES shopfloors(id)
                        )`);
    
    await pool.execute(`CREATE TABLE work_orders(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            jid VARCHAR(255) NOT NULL UNIQUE,
                            created_at TIMESTAMP DEFAULT NOW(),
                            ended_at TIMESTAMP NULL DEFAULT NULL
                        )`);
    
    await pool.execute(`CREATE TABLE tags(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            epc_code VARCHAR(255) NOT NULL UNIQUE,
                            created_at TIMESTAMP DEFAULT NOW()
                        )`);

    await pool.execute(`CREATE TABLE work_orders_tags(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            tag_id INTEGER NOT NULL,
                            work_order_id INTEGER NOT NULL,
                            created_at TIMESTAMP DEFAULT NOW(),
                            FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
                            FOREIGN KEY(tag_id) REFERENCES tags(id)
                        )`);

    await pool.execute(`CREATE TABLE cells_work_orders_tags(
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            cell_id INTEGER NOT NULL,
                            work_order_tag_id INT NOT NULL,
                            entered_at TIMESTAMP DEFAULT NOW(),
                            moved_at TIMESTAMP NULL DEFAULT NULL,
                            FOREIGN KEY(cell_id) REFERENCES cells(id),
                            FOREIGN KEY(work_order_tag_id) REFERENCES work_orders_tags(id)
                        )`);
    
    await pool.end();

    console.log('Tables creation is success!');
}
