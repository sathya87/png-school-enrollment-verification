const express = require("express");
const { login } = require("../auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const result = login(username, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

module.exports = router;
