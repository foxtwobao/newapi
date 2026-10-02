// dbcheck exercises native startup migrations on an explicitly isolated database.
// It starts no HTTP listener, scheduler, upstream request or task poller.
package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func main() {
	if os.Getenv("NEWAPI_DATABASE_CHECK") != "isolated" {
		fmt.Fprintln(os.Stderr, "Set NEWAPI_DATABASE_CHECK=isolated and supply an isolated SQL_DSN/LOG_SQL_DSN or SQLITE_PATH")
		os.Exit(2)
	}
	common.SQLitePath = os.Getenv("SQLITE_PATH")
	if os.Getenv("SQL_DSN") == "" && common.SQLitePath == "" {
		panic("an explicit isolated database is required")
	}
	common.IsMasterNode = false
	if err := model.InitDB(); err != nil {
		panic(err)
	}
	if err := model.InitLogDB(); err != nil {
		panic(err)
	}
	versionQuery := "SELECT version()"
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	if err := model.DB.Raw(versionQuery).Scan(&version).Error; err != nil {
		panic(err)
	}
	fmt.Println("database version:", version)
	before := businessData()
	if err := model.CloseDB(); err != nil {
		panic(err)
	}
	for pass := range 2 {
		common.IsMasterNode = true
		if err := model.InitDB(); err != nil {
			panic(err)
		}
		if err := model.InitLogDB(); err != nil {
			panic(err)
		}
		after := businessData()
		for table, hash := range before {
			if after[table] != hash {
				panic("migration changed existing business data in " + table)
			}
		}
		before = after
		fmt.Printf("migration pass %d preserved %d business tables\n", pass+1, len(after))
		if err := model.CloseDB(); err != nil {
			panic(err)
		}
	}
}

func businessData() map[string]string {
	hashes := map[string]string{}
	for _, table := range []string{"users", "tokens", "channels", "options", "tasks"} {
		if !model.DB.Migrator().HasTable(table) {
			continue
		}
		var rows []map[string]any
		if err := model.DB.Table(table).Find(&rows).Error; err != nil {
			panic(err)
		}
		encodedRows := make([]string, 0, len(rows))
		for _, row := range rows {
			encoded, err := common.Marshal(row)
			if err != nil {
				panic(err)
			}
			encodedRows = append(encodedRows, string(encoded))
		}
		slices.Sort(encodedRows)
		encoded, err := common.Marshal(encodedRows)
		if err != nil {
			panic(err)
		}
		hashes[table] = fmt.Sprintf("%x", sha256.Sum256(encoded))
		fmt.Printf("%s: %d rows, sha256 %s\n", table, len(rows), hashes[table])
	}
	return hashes
}
