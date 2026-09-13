// Apply optional OAuth after Lavalink has started. An expired login must not stop the service.
const enabled = process.env.YOUTUBE_OAUTH_ENABLED === 'true';
const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
if (enabled && refreshToken) {
  let applied = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:2333/youtube', {
        method: 'POST',
        headers: { Authorization: process.env.LAVALINK_PASSWORD, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, skipInitialization: true }),
        signal: AbortSignal.timeout(5000),
      });
      // Never print the response: it may contain credentials.
      await response.body?.cancel();
      if (!response.ok) {
        console.error('Pit-Stop: YouTube login could not be renewed; music service remains online.');
        break;
      }
      applied = true;
      console.log('Pit-Stop: YouTube login applied.');
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  if (!applied) console.error('Pit-Stop: Optional YouTube login is unavailable.');
}
