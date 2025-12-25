require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Import routes
const pairRouter = require('./pair');

class WhatsAppPairServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 8001;
        this.isProduction = process.env.NODE_ENV === 'production';
        
        this.initDirectories();
        this.configureMiddleware();
        this.configureRoutes();
        this.configureErrorHandling();
    }

    initDirectories() {
        const dirs = [
            './temp',
            './sessions',
            './logs',
            './temp/sessions',
            './sessions/active',
            './sessions/expired'
        ];

        dirs.forEach(dir => {
            fs.ensureDirSync(path.join(__dirname, dir));
        });

        console.log('📁 Directories initialized');
    }

    configureMiddleware() {
        // Security headers
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
                    connectSrc: ["'self'"],
                },
            },
        }));

        // CORS configuration
        this.app.use(cors({
            origin: true,
            credentials: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 100,
            message: 'Too many requests from this IP, please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
        });

        this.app.use('/api/', limiter);

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Compression
        this.app.use(compression());

        // Logging
        if (this.isProduction) {
            this.app.use(morgan('combined'));
        } else {
            this.app.use(morgan('dev'));
        }

        // Static files
        this.app.use(express.static(path.join(__dirname)));
        
        // Request logging
        this.app.use((req, res, next) => {
            const ip = req.ip || req.connection.remoteAddress;
            console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - IP: ${ip}`);
            next();
        });
    }

    configureRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: process.env.NODE_ENV,
                version: '2.0.0'
            });
        });

        // API routes
        this.app.use('/api/pair', pairRouter);

        // Serve main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'pair.html'));
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found'
            });
        });
    }

    configureErrorHandling() {
        // Error handler
        this.app.use((err, req, res, next) => {
            console.error('❌ Server Error:', err.stack);
            
            const statusCode = err.status || 500;
            const message = this.isProduction && statusCode === 500 
                ? 'Internal Server Error' 
                : err.message;

            res.status(statusCode).json({
                error: {
                    code: statusCode,
                    message: message,
                    timestamp: new Date().toISOString()
                }
            });
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught Exception:', error);
            process.exit(1);
        });
    }

    start() {
        const server = this.app.listen(this.port, () => {
            console.log('='.repeat(50));
            console.log(`✅ DTZ NOVA XMD Pairing Server Started`);
            console.log(`🌐 Port: ${this.port}`);
            console.log(`📁 Environment: ${process.env.NODE_ENV}`);
            console.log(`🕐 Server time: ${new Date().toLocaleString()}`);
            console.log(`🚀 Access: http://localhost:${this.port}`);
            console.log('='.repeat(50));
        });

        // Graceful shutdown
        const gracefulShutdown = () => {
            console.log('\n🛑 Received shutdown signal');
            console.log('🔌 Closing HTTP server...');
            
            server.close(() => {
                console.log('✅ HTTP server closed');
                process.exit(0);
            });

            setTimeout(() => {
                console.error('❌ Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    }
}

// Start the server
if (require.main === module) {
    const server = new WhatsAppPairServer();
    server.start();
}

module.exports = WhatsAppPairServer;
