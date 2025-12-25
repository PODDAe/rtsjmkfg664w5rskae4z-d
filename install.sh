

# DTZ NOVA XMD Installation Script
# Run with: bash install.sh

echo "======================================="
echo "DTZ NOVA XMD WhatsApp Pairing System"
echo "======================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js 16+ and try again"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed!"
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create necessary directories
echo ""
echo "📁 Creating directories..."
mkdir -p temp sessions logs sessions/active sessions/expired

echo "✅ Directories created"

# Set permissions
chmod -R 755 temp sessions logs

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "⚙️ Creating .env configuration file..."
    cat > .env << EOL
# Server Configuration
PORT=8001
NODE_ENV=development
HOST=0.0.0.0

# Security
SESSION_SECRET=$(openssl rand -base64 32)
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# WhatsApp Configuration
WHATSAPP_VERSION=2.2412.54
WHATSAPP_TIMEOUT=120000

# Paths
TEMP_DIR=./temp
SESSIONS_DIR=./sessions
LOG_DIR=./logs

# Features
ENABLE_LOGS=true
ENABLE_DEBUG=false
MAX_SESSIONS_PER_IP=3
SESSION_TIMEOUT=300000

# Admin Keys (Change these in production!)
STATS_KEY=admin_stats_key_$(openssl rand -hex 8)
CLEANUP_KEY=admin_cleanup_key_$(openssl rand -hex 8)
EOL
    echo "✅ .env file created"
else
    echo "ℹ️ .env file already exists"
fi

# Create PM2 ecosystem file
echo ""
echo "⚙️ Creating PM2 configuration..."
cat > ecosystem.config.js << EOL
module.exports = {
  apps: [{
    name: 'DTZ_NOVA_XMD',
    script: 'index.js',
    instances: 'max',
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
EOL

echo "✅ PM2 configuration created"

# Display installation summary
echo ""
echo "======================================="
echo "🎉 Installation Complete!"
echo "======================================="
echo ""
echo "To start the server:"
echo "1. Development mode: npm run dev"
echo "2. Production mode: npm start"
echo "3. PM2 mode: npm run pm2-start"
echo ""
echo "Access the interface at: http://localhost:8001"
echo "Health check: http://localhost:8001/health"
echo ""
echo "Admin endpoints:"
echo "- Stats: /api/pair/stats?key=<STATS_KEY>"
echo "- Cleanup: POST /api/pair/cleanup?key=<CLEANUP_KEY>"
echo ""
echo "Check .env file for your admin keys!"
echo "======================================="
[file content end]
