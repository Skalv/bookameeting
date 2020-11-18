require('dotenv').config()

var express = require('express')
  , bodyParser = require('body-parser')
  , GMail = new (require('./utils/Gmail'))()
  , Zoom = require('./utils/ZoomApi')
  , zoom = new Zoom()
  , DefenseManager = require('./utils/DefenseManager')
  , defenseManager = new DefenseManager(GMail, zoom)


var app = express();

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
})

app.get('/api/defenses', async (req, res) => {
  let newMails = await defenseManager.getNewDefenseMail()
  let synced = await defenseManager.getDefenses()

  return res.json({
    newMails: newMails,
    synced: synced
  })
})

app.post('/api/syncOne', (req, res) => {
  defenseManager.defenseHandler(req.body)
  .then(defense => {
    res.json(defense)
  }).catch(err => {
    console.error(err)
    res.status(500).json(err)
  })
})

app.get('/api/fetch', async (req, res) => {
  defenseManager.forceDefenseSync()

  res.send('OK')
})

module.exports = app