package model

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func ModelLoader() gin.HandlerFunc {
	return func(c *gin.Context) {
		text, _ := os.ReadFile("error.txt")

		if len(text) > 0 {
			c.HTML(http.StatusInternalServerError, "error.tmpl", gin.H{
				"text": string(text),
			})
			c.Abort()
		}

		c.Set("model", loadModel())
		c.Next()
	}
}

func loadModel() Model {
	var files []File
	content, _ := os.ReadFile("kaja-twirp.json")
	json.Unmarshal(content, &files)

	return Model{
		Files: files,
	}
}