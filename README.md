# The Hitech Great Place To Work® Tree

A light, single-page website styled like the Great Place to Work standee: the grey tree on the left, the "Add your hand" form on the right.
Every colleague adds a handprint (the same print as the standee) in one of six Hitech colours, with their name and one word. The word shows on the hand with their first name in small below it. The stem is Hitech, the hands are our people, and admins add the GPTW fruits.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The whole website: tree, "Add your hand" form, admin settings. About 55 KB to download. |
| `api/tree.js` | The small server function that saves entries in the database and checks the admin password. |
| `package.json` | Tells Vercel which database library to install. |

Opening `index.html` straight from your computer runs it in **preview mode** (entries are saved only in that browser, with sample hands). Once deployed with the database, everyone shares one tree.

## Put it online (Vercel + Neon, about 10 minutes)

1. Create a new GitHub repository and upload these three items: `index.html`, `package.json` and the `api` folder.
2. In Vercel, choose **Add New → Project**, import that repository, keep the default settings and click **Deploy**.
3. In the project, open **Storage → Create Database → Neon (Postgres)** and connect it to this project. This adds the `DATABASE_URL` setting automatically. (You can also connect the same Neon database you used for the Word Find app; the tree uses its own tables, `gptw_posts` and `gptw_settings`.)
4. Open **Deployments**, click the three dots on the latest one and choose **Redeploy**, so the site picks up the database.
5. Open your site link. The tables are created on the first visit.

Optional: add a custom address under **Settings → Domains**, for example `gptwtree.hitechdigital.com`.

## One hand per person

Each full name can add only one hand. Names are matched ignoring capitals, extra spaces and punctuation, so "Dipali Borisa" and "dipali  borisa." count as the same person. If someone tries again, the form says they already have a hand and offers to show it. On a shared office laptop, the next person can still add their own hand.

Admins can still add a hand for anyone (for example, two colleagues with the same name) from Admin settings → Entries, and can switch the rule off in Admin settings → Text.

## Admin

- Click the **gear icon** at the bottom right and enter the admin password.
- **Change the starting password straight away** in Admin settings → Password. (The starting password is the one shared in chat; you can also set a different starting password in Vercel with an `ADMIN_PASSWORD` environment variable before first use.)
- The password is checked on the server, so it is never visible in the page code. After 6 wrong tries, that connection is paused for 5 minutes.

| Tab | What you can do |
|---|---|
| Entries | Search, edit name/word/colour, delete one or many, approve waiting entries, add an entry yourself, delete everything |
| Fruits | Add one or five GPTW apples, place fruits by tapping the tree, change the fruit text, remove all fruits. Tap any fruit on the tree to remove it |
| Text | Headline, script line, question at the top of the form, button text, thank-you message, word ideas, longest word allowed, open/close the tree, approve-before-showing |
| Look | Hand colours (with a reset to the six Hitech colours), replace the top-left badge |
| Download | Excel (full name, word, colour, status, date + a word-count sheet), PNG image (2400 px or 4000 px), video of the tree growing (MP4 in Chrome/Edge) |
| Password | Change the admin password |

In admin mode you can also tap any hand on the tree to edit or delete it.

## Light on data

- No libraries or image files: the badge and logo are built in and compressed.
- The headline and script fonts are loaded only for the letters in the headline (a few KB). If they can't load, the page uses system fonts.
- The tree is drawn by the browser, not downloaded as pictures.
- Open pages check for new hands every 45 seconds; when nothing changed, the reply is a few bytes.
