async function testCobalt() {
    try {
        const response = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                url: 'https://www.instagram.com/reel/C8qLdJ5tV6y/'
            })
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Cobalt failed:", e.message);
    }
}
testCobalt();
