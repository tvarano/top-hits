
require('dotenv').config()
const express = require('express')
const request = require('request')
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express()
const sqlite3 = require('sqlite3');

const playlist_url_prefix = 'http://open.spotify.com/user/spotify/playlist';



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
        // mismatch in states, something wrong
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

        // get the user's token
        request.post(authOptions, function(loginError, loginResp, loginBody) {
            if (!loginError && loginResp.statusCode === 200) {
                // we have a successful token
                var token = loginBody.access_token
                // pack holds all necessary information to be passed to each request
                var pack = {
                    userId: null,               // spotify unique userid
                    token: token,               // access token
                    playlistId: null,           // the spotify playlist id
                    playlistUrl: null,          // the spotify playlist url
                    term: term,                 // long_term or short_term
                    tracks: []                  // the track uris to include
                }
                // hold all sequential operations in stack, go through sequentially
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
            pack.userId = JSON.parse(body).id
            // check if user exists, if not add them to the db
            let db = connectDataBase()
            let sql = `SELECT userid id from users WHERE userid = ?`
            db.get(sql, [pack.userId], function(err, row) {
                if (err) return console.log('158' + err.message);
                return row
                ? () => {
                    console.log(`user found: ${pack.userId}`)
                    // found a match, user is in database
                    // update last accessed in the db
                    let sql = `UPDATE users
                        SET last_accessed = ?
                        WHERE name = ?`
                    db.run(sql, [dateString(), pack.userId], (err) => {
                        if (err) return console.error('164' + err.message)
                })
                }        
                // no user found. create a new entry.       
                : createUser(pack, db)
            });
           
            nextOperations.pop()(pack, nextOperations, res, db)
        } else {
            res.redirect('/error')
        }
    })
}

function getPlaylist(pack, nextOperations, res, db) {
    // get the playlist for the user given the pack's term
    // query the db
    const sql_term = pack.term == 'long_term' ? 'long_id': 'short_id';
    let sql = `SELECT ${sql_term} pl
            FROM users
            WHERE userid  = ?`;
    db.get(sql, [pack.userId], (err, row) => {
        if (err) {
            return console.log('181' + err.message);
        }
        if (row) {
            pack.playlistId = row.pl;
            pack.playlistUrl = `${playlist_url_prefix}/${row.pl}`
            console.log(`${pack.userId} found playlist ${pack.playlistId}`)
        }
    });
    
    // legacy find by title, then enter into db
    if (!pack.playlistId) {
        request.get({
            url: 'https://api.spotify.com/v1/me/playlists?limit=50', 
            headers: {
                'Authorization': `Bearer ${pack.token}`
            }, 
            json: true
        }, (err, resp, body) => {
            if (!err && resp.statusCode === 200) {
                // search for appropriate playlist
                body.items.forEach(p => {
                    if (p.name == playlistInfo[pack.term].name) {
                        pack.playlistId = p.id
                        pack.playlistUrl = `${playlist_url_prefix}/${p.id}`
                        console.log(`${pack.userId} found playlist ${pack.playlistId}`)
                    }
                })
                if (!pack.playlistId) {
                    // if the playlist doesn't exist, create it
                    createPlaylist(pack, nextOperations, res, db)
                } else {
                    // add playlist to db
                    enterPlaylist(pack, db)
                    nextOperations.pop()(pack, nextOperations, res, db)
                }
            } else {
                res.redirect('/error')
            }
        })
    }
}

function createPlaylist(pack, nextOperations, res, db) {
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
            pack.playlistUrl = `${playlist_url_prefix}/${body.id}`
            // add playlist to the database
            enterPlaylist(pack, db)
            nextOperations.pop()(pack, nextOperations, res, db)
        } else {
            res.redirect('/error')
        }
    })
}

function getTracks(pack, nextOperations, res, db) {
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
            nextOperations.pop()(pack, nextOperations, res, db)
        } else {
            res.redirect('/error')
        }
    })
}

function populate(pack, nextOperations, res, db) {
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
            nextOperations.pop()(pack, nextOperations, res, db)
        } else {
            // playlist likely does not exist.
            // create the playlist, then populate again
            nextOperations.push(populate);
            createPlaylist(pack, nextOperations, res, db);
        }
    })
}

function showCompletion(pack, nextOperations, res, db) {
    db.close();
    res.redirect(pack.playlistUrl)
}


app.get('/error', (req, res) => {
    res.send('an error occurred :(\nsorry try again ig?\nPLS LMK IF THIS HAPPENS')
})


function createUser(pack, db) {
    // create a user in the db
    let dateStr = dateString()
    db.run(`INSERT INTO users VALUES(?, null, null, ?, ?)`,
    [pack.userId, dateStr, dateStr],
    function(err) {
        if (err) {
        return console.log('313' + err.message);
      }
      console.log(`created ${pack.userId}`);}
    );
}

function enterPlaylist(pack, db) {
    // enter playlist id into the database
    const sql_term = pack.term == 'long_term' ? 'long_id': 'short_id';
            sql = `UPDATE users
                    SET ${sql_term} = ?
                    WHERE userid = ?`
        db.run(sql, [pack.playlistId, pack.userId], (err) => {
            if (err) console.log('325' + err.message);
            console.log(`${pack.userId}: playlist entered`);
        }) 
}

function connectDataBase() {
    return new sqlite3.Database('./db/members.db', (err) => {
        if (err) {
          console.error('331' + err.message);
        }
    });
}

function dateString() {
    let today = new Date();
    return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
}

/*
var pack = {
    userId: null, 
    token: token, 
    playlistId: null, 
    playlistUrl: null,
    term: term,
    tracks: []
}
*/


app.listen(process.env.PORT || 5000, () => console.log(`listening on port ${process.env.PORT || 5000}`))