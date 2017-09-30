module.exports = function (grunt) {
  // Project configuration.
  const dist = './dist/';
  const server = './src/server/';
  const client = './src/client/';
  const contracts = './build/contracts/';

  grunt.initConfig(
    {
      pkg: grunt.file.readJSON('package.json'),
      clean: {dist: [dist]},
      exec: {compile: "truffle compile"},
      copy: {
        main: {
          files: [
            {
              expand: true,
              cwd: client,
              src: ['index.html'],
              dest: dist + "/src/client"
            },
            {
              expand: true,
              cwd: ".",
              src: ["package.json"],
              dest: dist
            },
            {
              expand: true,
              cwd: server,
              src: ['**/*'],
              dest: dist + "/src/server"
            },
            {
              expand: true,
              cwd: 'bower_components',
              src: ['**/*'],
              dest: dist + "/src/client"
            },
            {
              expand: true,
              cwd: contracts,
              src: ['**/*'],
              dest: dist + "/contracts"
            }
          ]
        }
      },
      browserify: {
        dist: {
          files: {
            "dist/src/client/client.js": client + "client.js"
          }
        }
      },
      watch: {
        s1: {
          files: ['client/*'],
          tasks: ['default']
        }
      }
    });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-exec');

  grunt.registerTask('default', ['clean', 'exec', 'copy', 'browserify']);
};