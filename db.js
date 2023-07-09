import 'dotenv/config'
import * as mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env['DB_HOST'] || '127.0.0.1',
  user: process.env['DB_USER'] || 'root',
  database: process.env['DB_DATABASE'] || undefined,
  password: process.env['DB_PASSWORD'] || undefined
})

export default pool
