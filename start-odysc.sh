#!/bin/bash
# Starts the Odysc backend and website, then opens it in your browser.
# Press Control + C in this window to stop both.
ROOT="$HOME/Odysc"
cd "$ROOT/backend" || { echo "Could not find $ROOT/backend"; exit 1; }

echo "1/4  Stopping any old copies..."
lsof -ti :3001 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 1

echo "2/4  Checking your settings..."
CHECK=$(node --env-file=.env --import tsx -e "import('./src/app.ts').then(m=>m.buildApp()).then(a=>{console.log('Config OK');return a.close()}).catch(e=>console.error('REAL ERROR:', e.message))" 2>&1 | grep -E "Config OK|REAL ERROR")
if [[ "$CHECK" != *"Config OK"* ]]; then
  echo "Settings problem: ${CHECK:-no output}"
  echo "Send this line to Claude."
  exit 1
fi

echo "3/4  Starting the backend..."
node --env-file-if-exists=.env --import tsx src/server.ts > /tmp/odysc-backend.log 2>&1 &
BACKEND=$!
for i in $(seq 1 20); do curl -s http://127.0.0.1:3001/health > /dev/null && break; sleep 1; done
if ! curl -s http://127.0.0.1:3001/health > /dev/null; then
  echo "Backend did not start. Last lines of its log:"; tail -n 5 /tmp/odysc-backend.log
  kill $BACKEND 2>/dev/null; exit 1
fi

echo "4/4  Starting the website..."
cd "$ROOT/client"
[ -x node_modules/.bin/vite ] || npm install
npx vite > /tmp/odysc-client.log 2>&1 &
WEBSITE=$!
for i in $(seq 1 20); do curl -s http://localhost:5173 > /dev/null && break; sleep 1; done

trap 'echo; echo "Stopping..."; kill $BACKEND $WEBSITE 2>/dev/null; exit 0' INT
echo
echo "Odysc is running at http://localhost:5173"
echo "Press Control + C to stop."
command -v open > /dev/null && open http://localhost:5173
wait
