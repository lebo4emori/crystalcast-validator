FROM centos7/nodejs-12-centos7 
USER root

WORKDIR /crystalcast 
COPY . ${WORKDIR}

RUN yum -y install epel-release && \
    yum -y update &&\
    yum -y groupinstall 'Development Tools' && \
    yum -y install R-core-devel R && \
    eval $(/crystalcast/set-email-cred) && \
    Rscript /crystalcast/R/requirements.R && \
    rm -f set-email-cred && \
    groupadd --gid 10010 crystalcast && \
    useradd --create-home --home-dir /home/crystalcast --shell /bin/sh --uid 10010 --gid 10010 crystalcast
    #chown -R crystalcast:crystalcast  /crystalcast && \
    #mkdir -p /crystalcast/files/ && \
    #chmod -R 0755 /crystalcast/files/

CMD ["npm", "run", "validator"]
