FROM node:24-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache libc6-compat

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]