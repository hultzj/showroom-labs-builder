// OpenShift sign-in for login.mjs, separate so it can be tested without a browser.
// Handles whatever OpenShift OAuth asks for, in any order: the identity-provider list, the Keycloak or
// OpenShift login form, the authorize (consent) page. Done once the browser is on the target host with
// no form or consent page showing, for `settle` consecutive checks; throws otherwise.
export async function signIn(page, target, { user, password, idp }, { tries = 40, settle = 3, waitMs = 1500 } = {}) {
  const host = new URL(target).host;
  const on = () => new URL(page.url()).host;
  const visible = (loc) => loc.isVisible().catch(() => false);
  await page.goto(target, { waitUntil: "domcontentloaded" });
  let settled = 0;
  for (let i = 0; i < tries && settled < settle; i++) {
    const links = page.locator("a[href*='/oauth/authorize'], a[href*='idp=']");
    const kc = page.locator("#kc-form-login #username");
    const ocp = page.locator("#inputUsername");
    const allow = page.getByRole("button", { name: /Allow selected permissions/i });
    let prompted = true;  // a form or consent page was showing on this pass
    if (await visible(kc)) {
      await kc.fill(user); await page.locator("#password").fill(password);
      await page.locator("#kc-login, [type=submit]").first().click();
    } else if (await visible(ocp)) {
      await ocp.fill(user); await page.locator("#inputPassword").fill(password);
      await page.locator("[type=submit]").first().click();
    } else if (await visible(allow)) {
      await allow.click();
    } else if (on() !== host && (await links.count())) {
      const names = (await links.allInnerTexts()).map((t) => t.trim());
      const pick = idp ? names.findIndex((n) => n.toLowerCase() === idp.toLowerCase()) : names.length === 1 ? 0 : -1;
      if (pick < 0) throw new Error(`choose an identity provider with IDP=: ${names.join(", ")}`);
      await links.nth(pick).click();
    } else prompted = false;
    // Signed in only once the target host shows no login form: a form there may have rejected us.
    settled = on() === host && !prompted ? settled + 1 : 0;
    await page.waitForTimeout(waitMs);
  }
  if (settled < settle) throw new Error(`login to ${target} did not finish (now at ${on()})`);
}
