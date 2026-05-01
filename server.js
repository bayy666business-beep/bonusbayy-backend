import express from "express";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_REDIRECT_URI,
  FRONTEND_URL = "https://bonusbayy.com",
  SESSION_SECRET,
  NODE_ENV,
} = process.env;

if (!SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET in environment variables.");
}

const isProduction = NODE_ENV === "production";

app.set("trust proxy", 1);

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());

app.use(
  session({
    name: "rawbonus.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.get("/auth/twitch", (req, res) => {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    scope: "user:read:email",
  });

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/twitch/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error("Twitch auth error:", error, error_description);
    return res.redirect(`${FRONTEND_URL}?login=failed`);
  }

  if (!code) {
    console.error("Missing authorization code");
    return res.redirect(`${FRONTEND_URL}?login=failed`);
  }

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return res.redirect(`${FRONTEND_URL}?login=failed`);
    }

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Client-Id": TWITCH_CLIENT_ID,
      },
    });

    const userData = await userRes.json();

    if (!userRes.ok || !userData.data || userData.data.length === 0) {
      console.error("No user data from Twitch:", userData);
      return res.redirect(`${FRONTEND_URL}?login=failed`);
    }

    const user = userData.data[0];

    req.session.user = {
      twitchId: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
      email: user.email || null,
    };

    res.redirect(`${FRONTEND_URL}?login=success`);
  } catch (err) {
    console.error("Callback error:", err);
    res.redirect(`${FRONTEND_URL}?login=failed`);
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      loggedIn: false,
      user: null,
    });
  }

  res.json({
    loggedIn: true,
    user: req.session.user,
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: "Logout failed",
      });
    }

    res.clearCookie("rawbonus.sid");
    res.json({ ok: true });
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});