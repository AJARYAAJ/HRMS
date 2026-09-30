# Going live: deploy PeopleHub on your own virtual machine

This guide takes you from an empty cloud VM to PeopleHub running at `https://hr.yourcompany.com`, with HTTPS,
email, backups and one-command updates. It works on any provider that gives you an Ubuntu VM: AWS (EC2 or
Lightsail), Microsoft Azure, Google Cloud, DigitalOcean, Hostinger, Linode and others.

There are two ways to run it. Pick one:

| | **Option A: Docker** (recommended) | **Option B: direct install** |
| --- | --- | --- |
| What runs | Two containers: PeopleHub, and Caddy for HTTPS | Node.js + systemd + Nginx + Certbot |
| HTTPS | Automatic | One Certbot command |
| Updates | `git pull && docker compose up -d --build` | `./deploy/update.sh` |
| Best for | Most people | Admins who prefer no Docker |

Allow **30–45 minutes** the first time.

---

## Step 1: Create the virtual machine

1. In your cloud console, create a VM with:
   - **OS:** Ubuntu Server 24.04 LTS (22.04 also works);
   - **Size:** 2 vCPU, 2 GB RAM and 30 GB disk handles about 500 employees (1 vCPU / 1 GB is enough for a trial);
   - **Networking:** a **static/public IP**. AWS calls this an "Elastic IP", Azure a "static public IP", and GCP a
     "reserved external IP".
2. Allow inbound traffic on these ports in the VM's firewall or security group:
   - **22** (SSH), preferably only from your own IP;
   - **80** (HTTP), needed for the HTTPS certificate;
   - **443** (HTTPS).
3. Connect to the VM:
   ```bash
   ssh ubuntu@YOUR_SERVER_IP            # AWS/Lightsail user is "ubuntu"; Azure/GCP use the user you created
   ```
4. Update the VM and turn on its firewall:
   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
   ```

## Step 2: Point your domain at the server

At your domain registrar (GoDaddy, Namecheap, Cloudflare, …) add a DNS record:

| Type | Name | Value |
| --- | --- | --- |
| A | `hr` (for hr.yourcompany.com) | `YOUR_SERVER_IP` |

Wait a few minutes, then check it from the VM:

```bash
getent hosts hr.yourcompany.com          # should print YOUR_SERVER_IP
```

> Using Cloudflare? Set the record to **DNS only** (grey cloud) until HTTPS is working, then turn the proxy on if
> you want it.

## Step 3: Get the code and configure it

```bash
sudo apt -y install git
sudo mkdir -p /opt/peoplehub && sudo chown $USER /opt/peoplehub
git clone https://github.com/AJARYAAJ/hrms.git /opt/peoplehub
cd /opt/peoplehub
cp .env.example .env
openssl rand -hex 32                     # copy the output: it's your JWT_SECRET
nano .env
```

In `.env`, set at least these values (keep the quotes around values that contain spaces):

| Setting | Example | Notes |
| --- | --- | --- |
| `JWT_SECRET` | the 64-character value from `openssl rand -hex 32` | **Required.** Keep it secret. Changing it signs everyone out |
| `APP_URL` | `https://hr.yourcompany.com` | Used in email links, installer commands, pre-boarding links and ID card QR codes — set it to your real address |
| `DOMAIN` | `hr.yourcompany.com` | Option A only: Caddy requests the certificate for it |
| `ADMIN_EMAIL` | `you@yourcompany.com` | Your administrator login. Only used on the very first start |
| `ADMIN_PASSWORD` | a strong password (10+ characters) | Change it after first sign-in (click your name → **My Profile** → Change password) |
| `COMPANY_NAME` | `"Acme Consulting Pvt. Ltd."` | Can be changed later in Settings |
| `SMTP_*` | see [Step 6](#step-6-turn-on-email) | Optional now, recommended before inviting employees |

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

> **Demo server instead?** Add `SEED_DEMO=1` to load the demo company (Nimbus Technologies, 40 employees, every
> password `Password@123`). Never do this on the server your real employees will use.

---

## Step 4A: Start with Docker (recommended)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Build and start (the first build takes about 5 minutes)
cd /opt/peoplehub
docker compose up -d --build
docker compose logs -f app               # wait for "PeopleHub HRMS API running" then press Ctrl+C
```

Open **https://hr.yourcompany.com**. Caddy obtains the HTTPS certificate on the first visit, which can take up to a
minute. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Your data lives in the Docker volume `peoplehub-data`: the database and uploaded files.

Useful commands:

```bash
docker compose ps                        # status
docker compose logs -f app               # live logs
docker compose restart app               # restart
docker compose exec app node --no-warnings scripts/backup.mjs   # manual backup (saved in the data volume under /data/backups)
```

Go to [Step 5](#step-5-first-sign-in-checklist).

---

## Step 4B: Direct install (without Docker)

```bash
# 1. Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs nginx
node -v                                   # must be v22.13 or newer

# 2. (Optional) Go 1.24+, to build the Windows/macOS desktop agent downloads
sudo snap install go --classic

# 3. A dedicated system user that owns the app
sudo useradd --system --home /opt/peoplehub --shell /usr/sbin/nologin peoplehub
sudo chown -R peoplehub:peoplehub /opt/peoplehub
cd /opt/peoplehub

# 4. Install and build
sudo -u peoplehub env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
sudo -u peoplehub npm run build
sudo -u peoplehub npm run agent:build     # only if you installed Go
sudo -u peoplehub mkdir -p server/data backups

# 5. Run it as a service (starts on boot, restarts if it crashes)
sudo cp deploy/peoplehub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now peoplehub
sudo journalctl -u peoplehub -n 20        # should say "created the organisation and administrator …"

# 6. Nginx reverse proxy + free HTTPS certificate
sudo sed "s/hr.example.com/hr.yourcompany.com/" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/peoplehub >/dev/null
sudo ln -sf /etc/nginx/sites-available/peoplehub /etc/nginx/sites-enabled/peoplehub
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d hr.yourcompany.com --redirect -m you@yourcompany.com --agree-tos -n
```

Open **https://hr.yourcompany.com** and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Certbot renews the
certificate automatically.

---

## Step 5: First sign-in checklist

Work through these in order. Each is a few minutes in the app:

1. **My Profile** (click your name, top right) → **Change password**.
2. **Settings → Company:** legal name, address, PAN/TAN, financial year, weekly off and salary day.
3. **Organization:**
   - legal entities (companies);
   - departments and designations;
   - locations (add latitude/longitude if you want geo-fenced clock-in);
   - shifts.
4. **Settings → Leave policy** and **Holidays:** adjust leave types and quotas, and add this year's holiday list.
5. **Settings → Approval workflows:** choose manager-only, manager → HR, or HR-only approval for each request type.
6. **Payroll → Settings:** basic % and HRA % of CTC.
7. **Employees → Import:**
   - download the CSV template, fill it in and import it (validate first);
   - or add people one by one;
   - each person receives a welcome email with a sign-in link once email is configured.
8. **Documents:** upload company policies and tick "Requires acknowledgement" where needed.
9. **Recruitment:** your public careers page is at `https://hr.yourcompany.com/careers`.
10. **Productivity → Devices** (optional): install the desktop agent on laptops. See
    [agent/README.md](../agent/README.md).

## Step 6: Turn on email

PeopleHub sends welcome emails, approvals, password resets, payslip notices, invoices and letters. Any SMTP
provider works:

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` / `SMTP_PASS` |
| --- | --- | --- | --- |
| Google Workspace / Gmail | `smtp.gmail.com` | `587` | your address / an [app password](https://myaccount.google.com/apppasswords) |
| Microsoft 365 | `smtp.office365.com` | `587` | your address / password (SMTP AUTH must be enabled) |
| Zoho Mail | `smtp.zoho.in` | `587` | your address / app password |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` | SES SMTP credentials |
| SendGrid | `smtp.sendgrid.net` | `587` | `apikey` / your API key |

Set these in `.env` together with `SMTP_FROM="Acme HR <hr@acme.com>"`, then restart:
- Docker: `docker compose up -d`
- direct install: `sudo systemctl restart peoplehub`

Check delivery in **Settings → Email → Send test email**.

## Step 7: Backups

A backup is a consistent copy of the database plus all uploaded files. It is safe to take while PeopleHub is
running.

**Direct install:** schedule a nightly backup at 02:30, keeping the last 14:

```bash
sudo -u peoplehub crontab -e
# add this line:
30 2 * * * cd /opt/peoplehub && set -a && . ./.env && set +a && npm run backup >> backups/backup.log 2>&1
```

**Docker:**

```bash
crontab -e
# add this line:
30 2 * * * cd /opt/peoplehub && docker compose exec -T app node --no-warnings scripts/backup.mjs >> backup.log 2>&1
```

Copy backups off the server too, for example with your provider's snapshot feature, or with
`rclone copy /opt/peoplehub/backups remote:peoplehub-backups` to S3, Google Drive or another destination.

With Docker, backups are written inside the data volume at `/data/backups`. Copy them out with
`docker compose cp app:/data/backups ./backups`.

**To restore (direct install):**

1. Stop PeopleHub.
2. Copy `backups/<date>/hrms.db` to `server/data/hrms.db`, and `backups/<date>/uploads/` to `server/data/uploads/`.
3. Start PeopleHub again.

**To restore (Docker):**

```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c 'cp /data/backups/<date>/hrms.db /data/hrms.db && rm -rf /data/uploads && cp -r /data/backups/<date>/uploads /data/uploads'
docker compose start app
```

## Step 8: Update to a new version (and see the changes)

**Docker:**

```bash
cd /opt/peoplehub
docker compose exec -T app node --no-warnings scripts/backup.mjs
git pull
docker compose up -d --build
```

**Direct install:**

```bash
cd /opt/peoplehub
sudo -u peoplehub ./deploy/update.sh    # backup → pull → install → build → restart → health check
```

Database changes are applied automatically when the server starts, and existing data is kept. Users see the new
version the next time they load a page. The web app is never cached across a deploy, so no one needs to clear
their browser. If you have the app installed as a PWA, close and reopen it.

## Step 9: Desktop activity agent (optional)

When Go is installed (direct install) or with Docker (always), PeopleHub builds and serves the Windows and macOS
agent. In **Productivity → Devices → Register device** you get:

- a one-line PowerShell command (Windows) or Terminal command (macOS);
- or a setup file to put next to the downloaded program.

See [agent/README.md](../agent/README.md) for what it records, permissions and code signing.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Site doesn't load | Check `docker compose ps` or `sudo systemctl status peoplehub`, then the logs. Check ports 80/443 are open in the cloud firewall and in `ufw` |
| "Set JWT_SECRET…" in the logs | Put a 64-character value from `openssl rand -hex 32` in `.env` |
| "First start in production needs ADMIN_EMAIL…" | Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Only needed while the database is empty |
| HTTPS certificate error | DNS must point at the server before the first start, and port 80 must be reachable. Check Caddy's logs (`docker compose logs caddy`) or rerun Certbot |
| Emails not arriving | Use **Settings → Email** for the delivery log and error. Check SMTP credentials and `SMTP_FROM` (quoted) |
| "Too many failed sign-in attempts" | Wait 15 minutes or use **Forgot password**. The limit is `LOGIN_MAX_FAILURES` (default 10) |
| Uploads rejected as too large | Raise `MAX_UPLOAD_MB` (default 10), and `client_max_body_size` in Nginx or `max_size` in the Caddyfile |
| Forgot the admin password and email isn't set up | See the command after this table. It sets a new password for `you@yourcompany.com` |

Resetting the admin password from the server:

```bash
cd /opt/peoplehub/server && sudo -u peoplehub node --no-warnings -e "
const b=require('bcryptjs');const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_PATH||'data/hrms.db');
db.prepare('UPDATE employees SET password_hash=? WHERE email=?').run(b.hashSync('NewStr0ngPass!',12),'you@yourcompany.com');console.log('done')"
```

With Docker, run the same inside the container: `docker compose exec app sh -c "cd server && node …"`, with
`DB_PATH` already set.

## Security checklist

- [ ] `JWT_SECRET` is a fresh random value, and `.env` is readable only by you (`chmod 600 .env`).
- [ ] You changed the admin password after first sign-in, and demo data (`SEED_DEMO`) is **off**.
- [ ] SSH is key-based only, with port 22 limited to your IP in the cloud firewall.
- [ ] Nightly backups run and are copied off the server.
- [ ] The VM gets security updates:
  `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

Built in: security headers, sign-in rate limiting, and hashed passwords (bcrypt). Files are served only to people
allowed to see them.
