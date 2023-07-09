import express from 'express'

const router = express.Router()

/**
 * Do logout (clear client cookie)
 */
router.post('/', (req, res) => {
  res.clearCookie('rtls-user', {
    sameSite: 'none',
    httpOnly: true,
    secure: true
  })
  return res.send('logout success')
})

export default router