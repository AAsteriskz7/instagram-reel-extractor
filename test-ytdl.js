import youtubedl from 'youtube-dl-exec';

async function testYtdl() {
    try {
        const url = 'https://www.instagram.com/reel/C8qLdJ5tV6y/';
        const output = await youtubedl(url, {
            dumpJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            youtubeSkipDashManifest: true
        });
        
        console.log("Success!");
        console.log("Title/Caption:", output.title || output.description);
        console.log("Video URL:", output.url);
    } catch (e) {
        console.error("yt-dlp failed:", e.message);
    }
}
testYtdl();
