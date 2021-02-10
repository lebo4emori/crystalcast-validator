pipeline {

  agent {
      node {
          label 'win10'
      }
  }

  triggers {
    pollSCM('/2 * * * ') // Enabling being build on Push
  }

  tools {
    nodejs 'NodeJS 11.6.0'
  }

  stages {
    stage('Install') {
        steps {
            bat 'npm install'
        }
    }

    stage('Test') {
        steps {
            catchError(buildResult: 'SUCCESS', stageResult: 'FAILURE') {
                bat 'npm test'
           }
           junit(testResults: 'reports/junit.xml')
        }
    }

    stage('Pack') {
        steps {
           bat 'npm pack'
        }
    }

  }

  post {
        always {
            sendNotifications currentBuild.result
            archiveArtifacts artifacts: 'riskaware-crystalcast-validator-*.tgz', fingerprint: true
            junit 'build/reports/**/*.xml'
        }
        success {
            sendEmail("Successful");
        }
        unstable {
            sendEmail("Unstable");
        }
        failure {
            sendEmail("Failed");
        } 
    }

}

// get change log to be send over the mail
@NonCPS
def getChangeString() {
    MAX_MSG_LEN = 100
    def changeString = ""

    echo "Gathering SCM changes"
    def changeLogSets = currentBuild.changeSets
    for (int i = 0; i < changeLogSets.size(); i++) {
        def entries = changeLogSets[i].items
        for (int j = 0; j < entries.length; j++) {
            def entry = entries[j]
            truncated_msg = entry.msg.take(MAX_MSG_LEN)
            changeString += " - ${truncated_msg} [${entry.author}]\n"
        }
    }

    if (!changeString) {
        changeString = " - No new changes"
    }
    return changeString
}

def sendEmail(status) {
    GIT_EMAIL = powershell (
        script: "git show -s --pretty='format:\"%ae\"' ${GIT_COMMIT}",
        returnStdout: true
    ).trim()
    
    mail(
            to: "${GIT_EMAIL}",
            subject: "Build $BUILD_NUMBER - " + status + " (${currentBuild.fullDisplayName})",
            body: "Changes:\n " + getChangeString() + "\n\n Check console output at: $BUILD_URL/console" + "\n")
}