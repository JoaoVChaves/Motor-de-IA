FROM node:20-alpine

WORKDIR /usr/src/app

# Dependências nativas caso necessário para compilação
RUN apk add --no-cache libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

# Gera o client do Prisma
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
