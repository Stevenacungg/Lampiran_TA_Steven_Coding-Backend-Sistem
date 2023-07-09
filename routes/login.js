import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import pool from '../db.js'

const router = express.Router()

/**
 * Do login (check username password, set cookie if valid)
 */
router.post('/', async (req, res) => {
  if (!req.body.username || !req.body.password) {
    return res.status(400).send('username and password must be provided')
  }

  const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [req.body.username])
  if (users.length == 0) {
    return res.status(401).send('incorrect username or password')
  }
  const user = users[0]
  const match = await bcrypt.compare(req.body.password, user.password)

  if (match) {
    delete user.password
    delete user.id
    res.cookie('rtls-user', jwt.sign(user, 'BACKEND-SECRET-KEY'), {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      expires: new Date(Date.now() + 30 * 24 * 3600 * 1000)
    })
    return res.send(user)
  } else {
    return res.status(401).send('incorrect username or password')
  }
})

export default router
