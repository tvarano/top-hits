# Top Hits
## A tool for Spotify to keep in touch with your music tastes.
Clearly in extremely early development, Top Hits is a simple tool to populate a playlist for a Spotify user containing their favorite tracks in the past month. 

### Installation
Top Hits is an express-based JavaScript web application. To install on your personal device, follow these steps.

1. Clone the repo in your preferred directory

    `git clone https://github.com/tvarano/top-hits.git`
2. Install the required dependencies
    `npm install`
3. [Set up your Spotify application](https://developer.spotify.com/dashboard/applications) using the appropriate addresses for redirection.
4. In your project root, run the following to put your Client Id and secret in the application.
    
    `echo -e 'SPOTIFY_CLIENT_ID=<clientid>\nSPOTIFY_CLIENT_SECRET=<client_secret>' > .env`
        
5. Run

    `node .`


