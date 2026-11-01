
FROM node:20-alpine

WORKDIR /usr/src/app

# Dependências necessárias para alguns pacotes nativos
RUN apk add --no-cache libc6-compat

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do projeto
COPY . .

# Gera o Prisma Client
#RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

