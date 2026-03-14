const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const app = express();
const CLIENT_ID = '894798159325-dk6csaejr9g00lfr2s2bjjbsot9r8gb5.apps.googleusercontent.com';
const client = new OAuth2Client(CLIENT_ID);

app.use(express.json());

app.post('/api/auth/google', async (req, res) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken: req.body.token,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const user = {
      id: payload['sub'],
      email: payload['email'],
      name: payload['name'],
    };
    res.json({ user });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));