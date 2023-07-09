import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import methodOverride from 'method-override'
import mqtt from 'mqtt'
import fs from 'fs'

import login from './routes/login.js'
import logout from './routes/logout.js'
import account from './routes/account.js'
import workOrders from './routes/work-orders.js'
import shopfloors from './routes/shopfloors.js'
import cells from './routes/cells.js'
import { updateCellDetectedWorkOrdersByNodemcuCode } from './methods/cells.js'

// Create uploads folder (the function will create one if it does not exists, else ignore)
fs.mkdirSync('uploads', { recursive: true });

// Backend Server
const app = express()
const port = process.env['PORT'] || 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(methodOverride('_method'))
app.use(cors({
  origin: true,
  credentials: true
}))

app.use(express.static('uploads'))
app.use('/login', login)
app.use('/logout', logout)
app.use('/account', account)
app.use('/work-orders', workOrders)
app.use('/shopfloors', shopfloors)
app.use('/cells', cells)

app.post('/check-reader', (req, res) => {
  console.log('Params: ', req.params)
  console.log('Query: ', req.query)
  console.log('Body:', req.body)
  return res.send()
})

app.get('/', (req, res) => {
  res.send('Real-Time Locating System Backend v1.0.0')
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
});

// MQTT client
const mqtt_opts = {
  username: process.env.MQTT_BROKER_USERNAME,
  password: process.env.MQTT_BROKER_PASSWORD,
  port: process.env.MQTT_BROKER_PORT
}

const mqtt_client = mqtt.connect(process.env.MQTT_BROKER_ADDRESS, mqtt_opts)
const topicCellsDetectedWorkOrders = process.env.MQTT_TOPIC

mqtt_client.on('connect', () => {
  mqtt_client.subscribe(topicCellsDetectedWorkOrders, (err, granted) => {
    if (err) {
      console.log('error:', err)
    }

    console.log('Subscribed to MQTT', granted)
  })
})

mqtt_client.on('message', (topic, message, packet) => {
  if (topic === topicCellsDetectedWorkOrders) {
    // Split and trim (remove trailing and leading whitespace) to tokens
    const msgString = message.toString()
    let tokens = msgString.split(',')
    tokens = tokens.map((value) => value.trim())

    const nodemcuCode = tokens[0]
    tokens.splice(0, 1) // Delete the first element (remove the nodemcuCode)

    // Get the epc codes
    const epcCodes = []
    for (const epcCode of tokens) {
      if (epcCode.length > 0) {
        let processedCode = epcCode.replace('epc[', '').replace(']', '').replace(/ /g, '')
        epcCodes.push(processedCode)
      }
    }

    if (!nodemcuCode || !epcCodes) {
      return
    }

    updateCellDetectedWorkOrdersByNodemcuCode(nodemcuCode, epcCodes)
  }
})
