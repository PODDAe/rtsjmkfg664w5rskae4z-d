require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs-extra');
const path = require('path');
const cluster = require('cluster');
const os = require('os');

// Import routes
const pairRouter = require('./pair');

class WhatsAppPairServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 8001;
        this.isProduction = process.env.NODE_ENV === 'production';
        this.numCPUs = this.isProduction ? os.cpus().length : 1;
        
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
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                },
            },
        }));

        // CORS configuration
        this.app.use(cors({
            origin: process.env.NODE_ENV === 'production' 
                ? ['https://yourdomain.com'] 
                : '*',
            credentials: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP, please try again later.',
            standardHeaders: true,
            legacyHeaders: false,
            skipSuccessfulRequests: false
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
        
        // Request logging middleware
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
                memory: process.memoryUsage(),
                environment: process.env.NODE_ENV
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
                    timestamp: new Date().toISOString(),
                    path: req.url
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

    startCluster() {
        if (cluster.isMaster) {
            console.log(`🚀 Master ${process.pid} is running`);
            console.log(`📊 Starting ${this.numCPUs} workers`);

            // Fork workers
            for (let i = 0; i < this.numCPUs; i++) {
                cluster.fork();
            }

            cluster.on('exit', (worker, code, signal) => {
                console.log(`⚠️ Worker ${worker.process.pid} died`);
                console.log('🔄 Starting a new worker');
                cluster.fork();
            });
        } else {
            this.startWorker();
        }
    }

    startWorker() {
        const server = this.app.listen(this.port, '0.0.0.0', () => {
            console.log(`✅ Worker ${process.pid} started`);
            console.log(`🌐 Server running on port ${this.port}`);
            console.log(`📁 Environment: ${process.env.NODE_ENV}`);
            console.log(`🕐 Server time: ${new Date().toLocaleString()}`);
            console.log('='.repeat(50));
        });

        // Graceful shutdown
        const gracefulShutdown = () => {
            console.log('\n🛑 Received shutdown signal');
            console.log('🔌 Closing HTTP server...');
            
            server.close(() => {
                console.log('✅ HTTP server closed');
                console.log('🧹 Cleaning up resources...');
                
                // Cleanup logic here
                process.exit(0);
            });

            // Force close after 10 seconds
            setTimeout(() => {
                console.error('❌ Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    }

    start() {
        if (this.isProduction && this.numCPUs > 1) {
            this.startCluster();
        } else {
            this.startWorker();
        }
    }
}

// Start the server
if (require.main === module) {
    const server = new WhatsAppPairServer();
    server.start();
}

module.exports = WhatsAppPairServer;
[file content end]
