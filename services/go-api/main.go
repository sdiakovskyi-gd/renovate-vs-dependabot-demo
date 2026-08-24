// Deliberately pinned to outdated, vulnerable module versions.
//
// dgrijalva/jwt-go is abandoned; Renovate's `replacements:all` preset (part of
// config:recommended) proposes swapping it for golang-jwt/jwt, which is a
// package REPLACEMENT rather than a version bump. Dependabot cannot do this.
package main

import (
	"log"
	"net/http"

	"github.com/dgrijalva/jwt-go"
	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v2"
)

type config struct {
	Secret string `yaml:"secret"`
	Port   string `yaml:"port"`
}

func loadConfig(raw []byte) (config, error) {
	var c config
	err := yaml.Unmarshal(raw, &c)
	return c, err
}

func issueToken(secret, subject string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": subject,
	})
	return token.SignedString([]byte(secret))
}

func main() {
	cfg, err := loadConfig([]byte("secret: dev-only\nport: \"8080\"\n"))
	if err != nil {
		log.Fatal(err)
	}

	r := gin.Default()
	r.POST("/login", func(c *gin.Context) {
		user := c.Query("user")
		if user == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user required"})
			return
		}
		token, err := issueToken(cfg.Secret, user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"token": token})
	})

	log.Fatal(r.Run(":" + cfg.Port))
}
