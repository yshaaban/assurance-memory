FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml ./
COPY services/core ./services/core
COPY services/server ./services/server
RUN mvn -B -ntp package

FROM eclipse-temurin:21-jdk-jammy
RUN groupadd --gid 10001 assurance && useradd --uid 10001 --gid assurance --no-create-home assurance
WORKDIR /app
COPY --from=build /build/services/server/target/assurance-server-1.0.0.jar /app/server.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/server.jar"]
