export const getPrivateKey = () => {
  if (!process.env.PRIVATE_KEY) {
    throw "PRIVATE_KEY not set";
  }

  return process.env.PRIVATE_KEY;
};
