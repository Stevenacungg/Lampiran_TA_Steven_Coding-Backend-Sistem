import jwt from 'jsonwebtoken'

export default (req, res, next) => {
  try {
    const token = req.cookies['rtls-user']
    const decodedToken = jwt.verify(token, 'BACKEND-SECRET-KEY')

    if (decodedToken.role != 'entry-exit') {
      throw 'Invalid role'
    } else {
      req.user = decodedToken
      next()
    }
  } catch {
    res.status(401).json({
      error: new Error('Invalid request!')
    });
  }
};
