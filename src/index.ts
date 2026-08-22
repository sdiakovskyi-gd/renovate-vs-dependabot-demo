import express from 'express';
import { issueToken, verifyToken } from './auth';
import { fetchRepoSummary } from './client';

const app = express();
app.use(express.json());

app.post('/login', (req, res) => {
  const { user } = req.body ?? {};
  if (typeof user !== 'string' || user.length === 0) {
    return res.status(400).json({ error: 'user required' });
  }
  return res.json({ token: issueToken({ sub: user, role: 'user' }) });
});

app.get('/me', (req, res) => {
  const header = req.header('authorization') ?? '';
  const token = header.replace(/^Bearer /, '');
  try {
    return res.json(verifyToken(token));
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
});

app.get('/repos/:owner/:repo', async (req, res) => {
  try {
    const summary = await fetchRepoSummary(req.params.owner, req.params.repo);
    return res.json(summary);
  } catch {
    return res.status(502).json({ error: 'upstream failed' });
  }
});

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`listening on :${port}`));
}

export default app;
