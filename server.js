require('dotenv').config();
const express = require('express');
const cors = require('cors');

const ordersRouter = require('./routes/orders');
const webhookMP = require('./routes/webhook');
const webhookFocus = require('./routes/webhook-focusnfe');
const dropshipRouter = require('./routes/dropship');
const shippingRouter = require('./routes/shipping');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', ordersRouter);
app.use('/api', webhookMP);
app.use('/api', webhookFocus);
app.use('/api', dropshipRouter);
app.use('/api', shippingRouter);

app.get('/', (req, res) => res.send('Backend Céu Verde Amazônia rodando ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
