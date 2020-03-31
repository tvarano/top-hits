
require('dotenv').config()
const express = require('express')
const request = require('request')
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express()

app.use(express.static(__dirname + '/public'))
.use(cors())
.use(cookieParser());

app.get('/', (req, res) => {
    res.send('public/index.html')
})

const playlistInfo = {
    'short_term': {
        name: 'My Month in Review',
        description: 'My top songs in the past month.'
    }, 
    'long_term': {
        name: 'All-Time Favorites', 
        description: 'My all-time most played songs on Spotify'
    }
}

const redirects = {
    
    // short_term: req.protocol + '://' + req.get('host') + req.originalUrl + 'callback/monthly',
    // short_term: req.protocol + '://' + req.get('host') + req.originalUrl + 'callback/monthly'

    // short_term: 'http://localhost:5000/callback/monthly',
    // long_term: 'http://localhost:5000/callback/all-time'
    short_term: 'http://month-in-review.herokuapp.com/callback/monthly',
    long_term: 'http://month-in-review.herokuapp.com/callback/all-time'
}

let stateKey = 'spotify_auth_state';

var generateRandomString = function(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  
    for (var i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  };


function login(req, res, redirect) {
    let state = generateRandomString(16);
    res.cookie(stateKey, state);
    let scopes = 'playlist-modify-public user-read-email user-top-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: process.env.SPOTIFY_CLIENT_ID,
            scope: scopes,
            redirect_uri: redirect, 
            state: state
        })
    );
}

function callback(req, res, term) {
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;
    if (state === null || state !== storedState) {
        // mismatch in states
        res.redirect('/#' +
          querystring.stringify({
            error: 'state_mismatch'
          }));
      } else {
        res.clearCookie(stateKey);
        var authOptions = {
          url: 'https://accounts.spotify.com/api/token',
          form: {
            code: code,
            redirect_uri: redirects[term],
            grant_type: 'authorization_code'
          },
          headers: {
            'Authorization': 'Basic ' + (new Buffer(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'))
          },
          json: true
        };

        request.post(authOptions, function(loginError, loginResp, loginBody) {
            if (!loginError && loginResp.statusCode === 200) {
                // we have a successful token
                var token = loginBody.access_token
                var pack = {
                    userId: null, 
                    token: token, 
                    playlistId: null, 
                    playlistUrl: null,
                    term: term,
                    tracks: []
                }
                // populate pack and do all operations (stack format)
                let operations = [showCompletion, populate, getTracks, getPlaylist]
                getUserId(pack, operations, res)
            } else {
                res.redirect('/error')
            }
        })
    }
}

// landings
app.get('/login/all-time', (req, res) => {
    login(req, res, redirects.long_term)
})

app.get('/callback/all-time', (req, res) => {
    callback(req, res, 'long_term')
})

// login home for monthly login
app.get('/login/monthly', function(req, res) {
    login(req, res, redirects.short_term)
});

// redirect page for monthly login
app.get('/callback/monthly', function(req, res) {
    callback(req, res, 'short_term')
})

// NOTE refactor this so these functions are prototyped
function getUserId(pack, nextOperations, res) {
    // get the userId
    request.get({
        url: 'https://api.spotify.com/v1/me', 
        headers: {
            'Authorization': `Bearer ${pack.token}`
        }
    },
    (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
            pack.userId = JSON.parse(body).userId
            console.log(`${pack.userId} HAS SUCCESSFULLY LOGGED IN\nUSING THE ${pack.term} OPTION`)
            nextOperations.pop()(pack, nextOperations, res)
        } else {
            res.redirect('/error')
        }
    })
}

function getPlaylist(pack, nextOperations, res) {
    request.get({
        url: 'https://api.spotify.com/v1/me/playlists?limit=50', 
        headers: {
            'Authorization': `Bearer ${pack.token}`
        }, 
        json: true
    }, (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
            // search for appropriate playlist
            // NOTE in future, store ids keyed by userid
            body.items.forEach(p => {
                if (p.name == playlistInfo[pack.term].name) {
                    pack.playlistId = p.id
                    pack.playlistUrl = `http://open.spotify.com/user/spotify/playlist/${p.id}`
                }
            })
            if (!pack.playlistId) {
                // if the playlist doesn't exist, create it
                createPlaylist(pack, nextOperations, res)
            } else {
                nextOperations.pop()(pack, nextOperations, res)
            }
        } else {
            res.redirect('/error')
        }
    })
}

function createPlaylist(pack, nextOperations, res) {
    request.post({
            url: 'https://api.spotify.com/v1/me/playlists',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pack.token}`
            }, 
            body: {
                'name': playlistInfo[pack.term].name,
                'description': playlistInfo[pack.term].description,
                'public':true
            }, 
            json:true
        }, (err, resp, body) => {
        if (!err && (resp.statusCode === 200 || resp.statusCode === 201)) {
            pack.playlistId = body.id
            pack.playlistUrl = `http://open.spotify.com/user/spotify/playlist/${p.id}`
            nextOperations.pop()(pack, nextOperations, res)
        } else {
            res.redirect('/error')
        }
    })
}

function getTracks(pack, nextOperations, res) {
    request.get({
        url: `https://api.spotify.com/v1/me/top/tracks?time_range=${pack.term}&limit=30`, 
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pack.token}`
        }
    }, (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
            let songs = JSON.parse(body).items
            let uris = []
            songs.forEach(s => {
                uris.push(s.uri)
            })
            pack.tracks = uris
            nextOperations.pop()(pack, nextOperations, res)
        } else {
            res.redirect('/error')
        }
    })
}

function populate(pack, nextOperations, res) {
    request({
        url: `https://api.spotify.com/v1/playlists/${pack.playlistId}/tracks`, 
        method: 'PUT', 
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${pack.token}`
        },
        json:  {
            'uris': pack.tracks
        }
    }, (err, resp, body) => {
        if (!err && resp.statusCode === 201) {
            console.log('body: '+body)
            nextOperations.pop()(pack, nextOperations, res)
        } else {
            res.redirect('/error')
        }
    })
}

function showCompletion(pack, nextOperations, res) {
    res.redirect(pack.playlistUrl)
}


app.get('/error', (req, res) => {
    res.send('an error occurred :(\nsorry try again ig?\nPLS LMK IF THIS HAPPENS')
})



app.listen(process.env.PORT || 5000, () => console.log(`listening on port ${process.env.PORT || 5000}`))