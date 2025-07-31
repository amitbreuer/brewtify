(async function test() {
  const res = await fetch(
    `https://api.spotify.com/v1/me`,
    { headers: { Authorization: `Bearer BQBlf7h9dKtwHgsgbm_PV_cPfnKACLbswGi7uisNLoOtd6siXRxOsqq0_infa_nSSHHyWu0NGsAvq5UrxE0xkgnkLMvIlmGwqVy5dwAXGGzAGbOPSJnDEy6rPXo5Wvx2LVonr4u7v0E` } },
  );
  const { ok, status, statusText } = res;
  if (!ok) {
    console.error(`Request failed ${status} - ${statusText}`);
    return;
  }
  const data = await res.json();
  console.log(data);
})().catch(console.error);
