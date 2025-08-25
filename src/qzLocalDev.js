// src/qzLocalDev.js
// DEV-ONLY signing for QZ Tray using local demo keys
import qz from "qz-tray";
import { KJUR, hextob64 } from "jsrsasign";

// 1) Load PUBLIC certificate from /public
qz.security.setCertificatePromise((resolve, reject) => {
  fetch("/qz/digital-certificate.txt", { cache: "no-store" })
    .then(r => (r.ok ? r.text() : Promise.reject("Cert load failed")))
    .then(resolve)
    .catch(reject);
});

// 2) Paste the full PRIVATE key here (from private-key.pem)
// ⚠️ DEV ONLY — do not ship to production or a public repo
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDO45o7rCLx0lfE
9BPkNqHP3NlYH+m/6b6bwIWoBaz0VB4i4RFS9KfHIax/As0t2n2XIweUPrlHwgOc
cAGs0p3uWcIVBruPRtVGsZqSiji4rxwbWJ+QClTQrf1D7Q4Om5XacD2Wty2/l88o
M+MGLzyfBerlSLMgOtcrLUjpWMnF2AqVd5YwaEopxVHjB8a/S1Ru0f+eUjOEomBD
PPhLtBALRd6+xiQgfZ9Nrckltwe9gq68Xv0qJ5UoJUveNlOlWCFMoHQIHN6o52pL
pCNsWGeJxyrF0YtF38kB07H0z3JC2yQVbHKrDQ6Vz36+TAHKwyHmcfjXJBFJbk/u
lu2HNZO1AgMBAAECggEAJJYIUNQki9oULl6xY9Krc8xM3TIrjoYh8H4vxKJYTw7P
E4D0pNRiFStly0IuEZVJT2Bg9zzOXBu5ssD18t9+EUfrM/ewVGqEzc8blB2AYVyK
HmXiNcE19X9HQetaaIfoDKx7n7r+CpsohaYDWDUjRcXwn6JnFuSA54BHHAjZCbTU
53986s2EYCQJuK7AfyamCVhnNA89tcw+ITFaqDVhcK0tvdjDbhJ01Ac/HxiDddqy
W515oILt6G9TuicrSh7gtHh0pkgOwXuVybs34Mq4m78K7gZ6h05RE274uBkx1lri
6IJP6ocaPVoV6Jg7WbVrVLDZ2SHXhAi9ZymZTftXwwKBgQDo1wEXSERqfuMDkErx
q4e8rtzn2XC0fSifqDzVFv2iKdmOGFBdDPFU/BOIPIx+X1GzLf2I+bPKlkBuaZXy
Y3KmsRQhe+FunOrs/oY7G1IiB15MRpYUUtET9V+wdUz2FclcytOjH5MWBf9yK9SC
7LAypkfxCDVfo+hpt2XychHXMwKBgQDjd8qoEv6Bm/b+zE4Ht+G9dLDK7vYni4ZB
nhI+JFrbLOuo4k9b3DTlxSjHfcRDcsCwUHU9f08D09Xc8q3uyTiBD5mYY0kkn4hz
PmfK6naYmQaAy0wyItQHz3m8DIFkoMyzU0Xj8pCxz9SSU+4JhWzNeWSFbbnJoHsq
WeSetz9JdwKBgQCQtJ7O83Dhpr47hr+s9mfDkgFkbjSnV2mZ4Br+a+1xjQTSVLYN
Pm/12zvgXZELMP47l4eMS3O7oimk9SXloHyusDrMnIr8DbXLWFvf/BjNYTrvuKap
NtcNyl+P8TbFccDVVJC3PnZRJ6UcNbU7MRJISCNJ30ociGd23C4VwWLpFQKBgD4Q
v5EgraT7w2c+o8PjXortPhgBH9UmctmQofWmwcuv9BU+utybtytCop/cJyMoOn9h
VLwU8qBeuqnw5ZiT+wDsGsLDxH9jsD2Rt4xccUOt7WJTFlVPv37qE5NF7kBgx7ne
bOGHnAeIZ74NfJPIfimKh+0IRXtIeJLTuFe+NFx9AoGBAKCSB+H4V0IBZA4rC45U
/OtfsWQQ5jtiSnNsU+UVeBy7iwd5LLFjSpnb536bP/AhgX24y/GDJU/T+hv1erHc
TaZkxEVfhBXgwYea0/9vuZVL/ELWZ0kpUL71gvOiqhct1s5LEK7T5vPiv8ZT4NVk
5JKB5tfio1FFIk/Rmqalwbhf
-----END PRIVATE KEY-----
`;

// 3) Sign every privileged QZ call (SHA512withRSA)
qz.security.setSignatureAlgorithm("SHA512");
qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
  try {
    const signer = new KJUR.crypto.Signature({ alg: "SHA512withRSA" });
    signer.init(PRIVATE_KEY);
    signer.updateString(toSign);
    const hex = signer.sign();
    resolve(hextob64(hex)); // base64 signature
  } catch (e) {
    console.error("QZ signing failed:", e);
    reject(e);
  }
});
