# Path+ domains

| Host | Points to | App |
|------|-----------|-----|
| **api.pathplus.store** | VPS → Nginx → `127.0.0.1:3000` | Hono API |
| **admin.pathplus.store** | VPS → Nginx → `127.0.0.1:3001` | Admin dashboard |

## 1. DNS (registrar)

Create two **A** records for `pathplus.store`:

| Type | Name | Value |
|------|------|--------|
| A | `api` | your VPS public IP |
| A | `admin` | your VPS public IP |

Wait until they resolve:

```bash
dig +short api.pathplus.store
dig +short admin.pathplus.store
```

## 2. Apps (PM2)

```bash
cd /path/to/backend
bash deploy/pm2-setup.sh
```

## 3. Nginx

```bash
cd /path/to/backend
sudo bash deploy/nginx-setup.sh
```

HTTPS (after DNS works):

```bash
sudo bash deploy/nginx-setup.sh --ssl
```

## 4. Check

```bash
curl http://api.pathplus.store/health
# {"status":"ok"}

curl -I http://admin.pathplus.store/
# HTTP 200
```

Open in browser:

- API health: http://api.pathplus.store/health
- Dashboard: http://admin.pathplus.store
