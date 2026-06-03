import { app } from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`EventForge API server listening on port ${PORT}`);
});
