FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy ALL files from current directory to /app in container
COPY . .

# Use the PORT environment variable or default to 3000
ENV PORT=3000

EXPOSE 3000

#CMD ["npm", "start"]
# Use the PORT environment variable
CMD ["node", "server.js"]
