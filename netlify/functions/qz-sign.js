// /.netlify/functions/qz-sign
const crypto = require("crypto");

exports.handler = async (event) => {
  try {
    const { toSign } = JSON.parse(event.body || "{}");
    if (!toSign) return { statusCode: 400, body: "Missing toSign" };

    let keyPem = process.env.QZ_PRIVATE_KEY || "";
    if (!keyPem.includes("BEGIN")) keyPem = keyPem.replace(/\\n/g, "\n");

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(toSign);
    signer.end();
    const sig = signer.sign(keyPem).toString("base64");

    return { statusCode: 200, body: sig };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
