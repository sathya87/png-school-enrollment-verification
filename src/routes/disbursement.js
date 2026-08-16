const express = require("express");
const { requireAuth } = require("../auth");
const { calculateDisbursement } = require("../disbursement");

const router = express.Router();

router.get("/disbursement/:schoolId", requireAuth, (req, res) => {
  const result = calculateDisbursement(Number(req.params.schoolId));
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

module.exports = router;
