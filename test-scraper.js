import pkg from 'instagram-url-direct';
const { instagramGetUrl } = pkg;

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/C8qLdJ5tV6y/'; // Sample public reel
        const result = await instagramGetUrl(url);
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Scraper failed:", e.message);
    }
}
test();
