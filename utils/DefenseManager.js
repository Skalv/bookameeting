const _ = require('lodash')
var Datastore = require('nedb')
  , db = new Datastore({ filename: 'db/defenses.db', autoload: true });
const CronJob = require('cron').CronJob
const Moment = require('moment')
Moment.locale('fr')

class DefenseManager {

  constructor (gmail, zoom) {
    this.gmail = gmail
    this.zoom = zoom

    // this.gmail.connectToGmailPubSub('skmail-1602687435666', 'mesmails', 'liremesmails', this.onNewMail.bind(this))
  }
  /**
   * Test if the mail is a new OpenClassroom's projet defense for me or not
   */
  isNotNewDefense(str) {
    let match = /planifiée pour [A-Z]{1}[a-z]{1,}\s[A-Z]{1}[a-z]{1,}/.exec(str)
    return match
  }

  extractEmail(str) {
    let regex = /(?:[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[A-Za-z0-9-]*[A-Za-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/
    let matchs = regex.exec(str)
    
    return matchs[0].toLowerCase()
  }

  extractDatetime(str) {
    let reg = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}\sà\s[0-9]{2}:[0-9]{2}/
    let matchs = reg.exec(str)
    let dateReg = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}/
    let timeReg = /[0-9]{2}:[0-9]{2}/
    return {date: dateReg.exec(matchs[0])[0], time: timeReg.exec(matchs[0])[0]}
  }

  extractName(str) {
    const match = /planifiée avec [A-Z]{1}[A-Za-zà-öø-ÿ-]{1,}\s[A-Z]{1}[A-Za-zà-öø-ÿ-]{1,}(\s[A-Z]{1}[A-Za-zà-öø-ÿ-]{1,})?/.exec(
      str
    )
    if (match === null) {
      console.log(str)
    }
    return match[0].slice(15)
  }

  dateTimeFormat(date, time) {
    let splitedDate = date.split("/")
    let year = splitedDate[2]
    let month = splitedDate[1]
    let day = splitedDate[0]

    return `${year}-${month}-${day}T${time}:00`
  }

  findOrCreateDefense(defense) {
    return new Promise((resolve, reject) => {
      db.find({
        email: defense.email,
        datetime: defense.datetime
      }, (err, docs) => {
        if (err) return reject(err)
        if (docs.length > 0) {
          return resolve(docs[0])
        } else {
          db.insert({
            name: defense.name,
            email: defense.email,
            datetime: defense.datetime,
            emailId: defense.emailId,
            zoomId: '',
            mailSended: false
          }, (err, doc)=> {
            if (err) return reject(err)
  
            return resolve(doc)
          })
        }
      })
    })
  }

  updateDefense(defense, data) {
    return new Promise((resolve, reject) => {
      db.update(
        {_id: defense._id},
        {$set: data},
        {},
        (err, nbRepl) => {
          if (err) return reject(err)

          return resolve(nbRepl) 
        })
    })
  }

  async cleanAndExtractDefense(emails) {
    let defenses = await Promise.all(
      emails.map(async (mail) => {
        let mailContent = await this.gmail.getMail(mail)
        
        if (!this.isNotNewDefense(mailContent)) {
          let {date, time} = this.extractDatetime(mailContent)
          
          return {
            name: this.extractName(mailContent),
            email: this.extractEmail(mailContent),
            datetime: this.dateTimeFormat(date, time),
            emailId: mail.id
          }
        } else {
          return {invalid: true}
        }
      })
    )
    return defenses.filter(el => {return (!el.invalid)})
  }

  async getDefenses() {
    return new Promise((resolve, reject) => {
      db.find({}, (err, result) => {
        if(err) return reject(err)
        return resolve(result)
      })
    })
  }

  async getNewDefenseMail() {
    let query = "from:hello.students@notify.openclassrooms.com, subject:(Nouvelle Soutenance le)"
    let defenseEmails = await this.gmail.getMails(query)

    if (defenseEmails.length > 0) {
      let defenses = await this.cleanAndExtractDefense(defenseEmails)

      return defenses
    } else {
      return []
    }
  }

  defenseHandler(defense) {
    return new Promise(async (resolve, reject) => {
      let dbDefense = await this.findOrCreateDefense(defense)
        .catch((err) => {
          return reject(err)
        })

        if (dbDefense.zoomId == '') {
          console.log("### Nouvelle soutenance ###")
          let meeting = await this.zoom.createMeeting(dbDefense)
          .catch((err) => {
            return reject(err)
          })
    
          console.log("Synchro Zoom :", meeting.uuid)
          let content = `
          Bonjour ${dbDefense.name},
    
          La soutenance programmée le ${Moment(dbDefense.datetime).format('DD MMMM YYYY à kk:mm')} aura lieu sur la plateforme Zoom.
          
          Tu  pourras trouver le lien juste ici pour te connecter :
          ${meeting.join_url}
          
          Cordialement`
    
          await this.gmail.sendMail(
            'fboutin76@gmail.com',
            dbDefense.email,
            'Programmation de Soutenance Zoom',
            content
          ).catch((err) => {
            return reject(err)
          })
          
          await this.gmail.sendMail(
            'fboutin76@gmail.com',
            'fboutin76@gmail.com',
            'Programmation de Soutenance Zoom',
            content
          ).catch((err) => {
            return reject(err)
          })

          console.log("Mails OK")
          const syncedDefense = await this.updateDefense(dbDefense, {
            zoomId: meeting.uuid,
            mailSended: true
          }).catch((err) => {
            return reject(err)
          })
          console.log("Synchro terminé.")

          return resolve(syncedDefense)
        } else {
          console.log("already synced")
          return resolve(dbDefense)
        }
    })
  }

  

  async forceDefenseSync() {
    let defenses = await this.getDefenses()

    if (defenses.length > 0) {
      defenses.forEach(async (defense) => {
        await this.defenseHandler(defense)
      })
    }
  }

  async onNewMail(mail) {
    if (!this.isNotNewDefense(mail)) {
      let {date, time} = this.extractDatetime(mail)
      
      let defense =  {
        name: this.extractName(mail),
        email: this.extractEmail(mail),
        datetime: this.dateTimeFormat(date, time),
        emailId: mail.id
      }

      console.log("new defense", defense)
    } else {
      return {invalid: true}
    }
  }
}

module.exports = DefenseManager