const express = require('express')
const path = require('path')
const sqlite3 = require('sqlite3')
const {open} = require('sqlite')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server is Running at http://localhost:3000')
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

const getFollowingPeopleIdsOfUser = async username => {
  const getTheFollowingPeopleQuery = `
    select
    following_user_id from folllower 
    inner join user on user.user_id = follower.follower_user_id
    where user.username = '${username}';
    `
  const folllowingPeople = await db.all(getTheFollowingPeopleQuery)
  const arrayOfIds = folllowingPeople.map(
    eachUser => eachUser.following_user_id,
  )
  return arrayOfIds
}

const authentication = (request, response, next) => {
  const {tweet} = request.body
  const {tweetId} = request.params
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.payload = payload
        request.tweetId = tweetId
        request.tweet = tweet
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
    select * 
    from tweet inner join follower
    on tweet.user_id = follower.following_user_id
    where tweet.tweet_id = '${tweetId}' and follower_user_id = '${userId}';
    `
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = ` 
    select * from user where username = '${username}';`
  console.log(username, password, name, gender)
  const userDBDetails = await db.get(getUserQuery)
  if (userDBDetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createdUserQuery = `insert into user(username, password, name, gender)
            values('${username}', '${hashedPassword}', '${name}', '${gender}')`
      await db.run(createdUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = ` 
    select * from user where username = '${username}';`
  const userDbDetails = await db.get(getUserQuery)
  if (userDbDetails !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDbDetails.password,
    )
    if (isPasswordCorrect) {
      const payload = {username, userId: userDbDetails.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username)
  const getTweetsQuery = `
    select username, tweet, date_time as dateTime
    from user inner join tweet on user.user_id = tweet.user_id
    where user.user_id in (${followingPeopleIds}) 
    order by date_time DESC
    limit 4;`
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

app.get('/user/following/', authentication, async (request, response) => {
  const {username, userId} = request

  const getFollowingUsersQuery = `
    select name
    from follower inner join user on user.user_id = follower.following_user_id
    where follower_user_id = '${userId}';
    `
  const folllowingPeople = await db.all(getFollowingUsersQuery)
  response.send(folllowingPeople)
})

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request

  const getFollowersQuery = `
    select distinct name
    from follower inner join user on user.user_id = follower.follower_user_id
    where following_user_id = '${userId}';
    `
  const folllowers = await db.all(getFollowersQuery)
  response.send(folllowers)
})

app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `
    select tweet,
     (select count() from like where tweet_id = '${tweetId}') as likes,
     (select count() from reply where tweet_id = '${tweetId}') as replies,
     date_time as dateTime
        from tweet 
    where tweet.tweet_id = '${tweetId}';
    `
    const tweet = await db.all(getTweetQuery)
    response.send(tweet)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `
    select username
     
        from user inner join like on user.user_id = like.user_id 
    where tweet_id = '${tweetId}';
    `
    const likesUsers = await db.all(getLikesQuery)
    const usersAarry = likesUsers.map(eachUser => eachUser.username)
    response.send({likes: usersAarry})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getRepliesQuery = `
    select name, reply
     
        from user inner join reply on user.user_id = reply.user_id 
    where tweet_id = '${tweetId}';
    `
    const repliedUsers = await db.all(getRepliesQuery)

    response.send({replies: repliedUsers})
  },
)

app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request

  const getTweetsQuery = `
    select tweet,
     count(distinct like_id) as likes,
     count(distinct reply_id) as replies,
     date_time as dateTime
        from tweet left join reply on tweet.tweet_id = reply.tweet_id
        left join like on tweet.tweet_id = like.tweet_id
    where tweet.user_id = '${userId}'
    group by tweet.tweet_id;
    `
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const userId = paraInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const creatTweetQuery = `insert into tweet(tweet, user_id, date_time)
    values('${tweet}', '${userId}', '${dateTime}');`
  await db.run(creatTweetQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTheTweetQuery = ` select * from tweet where user_id = '${userId}' and tweet_id = '${tweetId}';`
  const tweet = await db.get(getTheTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `delete from tweet where tweet_id = '${tweetId}';`
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
