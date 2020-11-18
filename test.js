var chai = require('chai')
var assert = chai.assert
var expect = chai.expect
chai.use(require('chai-match'))
var request = require('supertest')

var server = require('./app.js')

describe('Web serveur', () => {
  it('Should return homepage', async () => {
    const res = await request(server).get('/')
    expect(res.status).to.equal(200)
  })

  it('Should have a login page', async() => {
    const res = await request(server).get('/login')
    expect(res.status).to.equal(200)
  })

  it('Should redirect to Google login', async () => {
    const res = await request(server).get('/login/google')
    expect(res.status).to.equal(302)
    expect(res.headers.location).to.match(/^https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth/)
  })

  it('Should redirect to login when user isn\'t connected', async() => {
    const res = await request(server).get('/profile')
    expect(res.status).to.equal(302)
    expect(res.headers.location).to.match(/\/login/)
  })
})

describe('SkMail', function () {

  var SkMail = require('./SkMail')
    , mail = new SkMail()
    , DataStore = require('nedb')
    , db = new DataStore({ filename: './db/users.db', autoload: true })

  describe('Fetch', function () {

    it('should return 10 emails from my mailbox', function () {
      db.find({}, (err, users) => {
        console.log('users', users);
      })

      let mails = SkMail.getMails(10)
      assert.typeOf(mails, 'array', 'return an Array')
      assert.lengthOf(mails, 10, 'return 10 mails')
    })

  })

})
