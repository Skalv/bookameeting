const JWT = require('jsonwebtoken')
const Axios = require('axios')
const _ = require('lodash')

class ZoomApi {
  constructor() {
    let payload = {
      iss: process.env.ZOOM_API_KEY,
      exp: ((new Date()).getTime() + 5000)
    }

    this.options =  {
      baseURL: 'https://api.zoom.us/v2/users/me/',
      headers: {
          'User-Agent': 'Zoom-Jwt-Request',
          'content-type': 'application/json',
          'Authorization': "Bearer " + JWT.sign(payload, process.env.ZOOM_API_SECRET)
      }
    }
  }

  getScheduledMeetings() {
    return new Promise((resolve, reject) => {

      let params = _.merge(this.options, {
        params: {
          userId: 'me',
          type: 'scheduled',
        }
      })

      Axios.get('meetings', params)
        .then((result) => {
          return resolve(result.data)
        }).catch((error) => {
          return reject(error)
        })
    })
  }

  createMeeting(defense) {
    return new Promise((resolve, reject) => {
      
      let params = {
        topic: `Soutenance Programmée - ${defense.name}`,
        type: 2,
        start_time: defense.datetime,
        timezone: 'Europe/Paris'
      }

      Axios.post('meetings', params, this.options)
        .then((result) => {

          return resolve(result.data)
        }).catch((err) => {

          return reject(err)
        })
    })
  }
}

module.exports = ZoomApi