
require('dotenv').config()
const express = require('express')
const request = require('request')
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express()
const port = 8888

app.use(express.static(__dirname + '/public'))
.use(cors())
.use(cookieParser());

app.get('/', (req, res) => {
    res.send('public/index.html')
})



const redirect_uri = 'http://localhost:8888/spotify-in/'
let stateKey = 'spotify_auth_state';

var generateRandomString = function(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  
    for (var i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  };


// login home
app.get('/spotify-login', function(req, res) {
    let state = generateRandomString(16);
    res.cookie(stateKey, state);
    let scopes = 'playlist-modify-public user-read-email user-top-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: process.env.SPOTIFY_CLIENT_ID,
            scope: scopes,
            redirect_uri: redirect_uri, 
            state: state
        })
    );
});

// redirect page
app.get('/spotify-in', function(req, res) {
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
            redirect_uri: redirect_uri,
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
                    tracks: [], 
                    complete: false
                }
                // populate pack and do all operations (stack format)
                let operations = [showCompletion, populate, getTracks, getPlaylist]
                getUserId(pack, operations, res)
            }
        })
    }
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
            nextOperations.pop()(pack, nextOperations, res)
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
                if (p.name == 'My Top Hits') {
                    pack.playlistId = p.id
                }
            })
            if (!pack.playlistId) {
                // if the playlist doesn't exist, create it
                createPlaylist(pack, nextOperations, res)
            } else {
                nextOperations.pop()(pack, nextOperations, res)
            }
        }
    })
}

function createPlaylist(pack, nextOperations, res) {
    console.log("CREATING PLAYLIST")
    request.post({
            url: 'https://api.spotify.com/v1/me/playlists',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pack.token}`
            }, 
            body: {
                'name':'My Top Hits',
                'description':'My most listened-to tracks over the past month.',
                'public':true
            }, 
            json:true
        }, (err, resp, body) => {
        if (!err && (resp.statusCode === 200 || resp.statusCode === 201)) {
            console.log(body)
            pack.playlistId = body.id
            nextOperations.pop()(pack, nextOperations, res)
        }
    })
}

function getTracks(pack, nextOperations, res) {
    request.get({
        url: 'https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=30', 
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
        }
    })
}

function showCompletion(pack, nextOperations, res) {
    res.send("DONE!")
}

app.listen(port, () => console.log(`listening on port ${port}`))