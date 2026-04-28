module.exports = {
  apps: [
    {
      name: "approval-central",
      script: "./dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
