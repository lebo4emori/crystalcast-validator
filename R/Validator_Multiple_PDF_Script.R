#' Combing data and Output Graphs for Single Forecast PDF output 
#' Crown Copyright © 2020, Defence Science and Technology Laboratory
#'
#; @author T Maishman, S Schaap & U Dalrymple

#######################
# Load Libraries
#######################
library(openxlsx)
library(readxl)
library(dplyr) 
library(tidyr)
library(reshape2)
library(lubridate) #date manipulation
library(ggplot2) #plots
library(scales) #changing axis from sci
library(gridExtra) #date manipulation
library(gtable)
library(grid)

#######################
# Clear memory
rm(list=ls())
#######################

args = commandArgs(trailingOnly = TRUE)

print(args)

WORKING_DIR <- args[1]
OUTPUT_FILENAME <- args[2]

#######################
# Set Up Configuration
#######################

# Set today's date (useful for testing to look at retrospecitve data):
today <- Sys.Date()
min_window_date <- today - (7 * 4)  # number of weeks before
max_window_date <- today + (7 * 8) # number of weeks after

delivery_date <- today # set default day initially
if(weekdays(today) %in% c("Thursday", "Friday", "Saturday", "Sunday","Monday")){
  num_days_until_delivery<-which(weekdays(delivery_date+c(1:5))=="Tuesday")
  delivery_date<-today + num_days_until_delivery
}
if(weekdays(today)=="Tuesday"){delivery_date<-today}
if(weekdays(today)=="Wednesday"){delivery_date<-today-1}

today <- delivery_date
tomorrow <- delivery_date+1

desired_types <- c("type28_death_inc_line", "hospital_inc", "infections_inc", "prevalence_mtp", "infections_prev", "num_positive_tests", "hospital_prev" ,
                   "R", "growth_rate", "incidence", "incidence_prev", "prevalence")

# add in a summary table - Nowcast and MTP only
metrics_of_interest_x<-c("R", "growth_rate", "incidence", "prevalence")
metrics_of_interest_time<-c("type28_death_inc_line", "hospital_inc", "infections_inc", "hospital_prev", "prevalence_mtp")  

# # # Commented working directory (for in-house testing)
# WORKING_DIR <- "K:/Project_Technical/Standard/PJ100026/Technical data/covid/Forecasting"
# OUTPUT_FILENAME <- "SPIMestimates-2021-01-12-7Day.xlsx"

#######################
# Functions
#######################

#Remove NA function
remove_na <- function(data, colname_val) {
  na.list <- complete.cases(data[, colname_val])
  return(data[na.list, ])
}

# Negate %in%:
`%notin%` <- Negate(`%in%`)  

# Merge case data:
add_historical_data <- function(data, Historical_data){
  
  scenarios <- unique(data$Scenario)
  groups <- unique(data$Group)
  all_group_hist <- list()
  test2 <- data.frame()
  
  for (scenario in scenarios){
    
    data_clean_temp <- data_clean %>% filter(Scenario == scenario)
    Historical_data$Scenario <- scenario 
      
    for (group in groups){
        
        loop_hist <- Historical_data
        loop_hist$Group <- group
        all_group_hist <- rbind(all_group_hist, loop_hist)
      
    }
    
    test <- merge(data_clean_temp, all_group_hist, by = c("Group", "ValueType", "Value.Date", "Geography", "AgeBand", "Scenario"), all = TRUE)
    test2 <- rbind(test2,distinct(test))
    
  }  
  
  return(test2)
}

#data indicator for last 4 days (death_inc_line data and hospitl_inc data for Wales and Scotland):
add_4day_indicator <- function(data){
  ###death_inc_line first######
  data$DEATH_4DAY_IND <- 0
  geographys <- unique(data$Geography)
  types <- c("type28_death_inc_line", "death_inc_line")
  ages <- unique(data$AgeBand)
  new_data <- c()
  for(geog in geographys){
    for(age in ages){
      for(type in types){
        case_data <-  data %>% filter(ValueType == type, AgeBand == age, Geography == geog, IND == 0) #case data for death inc line 
        forecast_data <- data %>% filter(ValueType == type, AgeBand == age, Geography == geog, IND != 0) #forecast data for death inc line
        
        if(nrow(case_data) > 0){
          
          n <- length(unique(case_data$Value.Date)) #how many case data entries are there? 
          if(n < 4){
            dates <- unique(case_data$Value.Date)[1:n] #lets get last dates 
          } else {
            dates <- unique(case_data$Value.Date)[(n-3):n] #lets get last 4 dates 
          }
          case_data <- case_data %>% mutate(DEATH_4DAY_IND = ifelse(Value.Date %in% dates,1, 0)) #add indicator, if the date is within our window then 1, else its 0
          
        }
        
        new_data <- rbind(new_data, case_data, forecast_data) #This will bind the case and forecast data back together again
      }
    }
  }
  all_other_data <- data %>% filter(ValueType  != "type28_death_inc_line" & ValueType  != "death_inc_line") %>% mutate(DEATH_4DAY_IND = 0) #Everything except death inc line
  combined <- as.data.frame(rbind(all_other_data, new_data)) #binding it back together - so this is all the data back to normal just with indicator for death inc line
  
  return(combined)
}

# Plots:

plot2 <- function(datasets, save = TRUE, summary_table_list){
  
  outputNameWithoutExtension <- tools::file_path_sans_ext(OUTPUT_FILENAME)
  
  path <- gsub(" ", "_",paste0(outputNameWithoutExtension, model_level_trim, ".pdf"))
  pdfFile <- paste0(WORKING_DIR, "/", path)
  print(paste("DEBUG:  plotting: ", pdfFile))
  
  
  pdf(pdfFile, onefile = TRUE, width=11, height=7.6)
  
  # summary table first
  
  
  for(n_table in 1:length(summary_table_list)){
    plot.new()
    print(grid.draw(get(summary_table_list[n_table])))
  }
  
  for (dataset_Plotting in datasets){
    
    
    dataset_Name<-dataset_Plotting
    if(dataset_Name=="data_clean"){dataset_Name<-"MTP"}
    dataset_Name<-gsub("data_clean_", "", dataset_Name)
    
    dataset_Plotting<-get(dataset_Plotting)
    if(nrow(dataset_Plotting)>0){
      
      types <- as.character(unique(dataset_Plotting$ValueType)) # get all value type from the dataset_Plotting
      ages <- as.character(unique(dataset_Plotting$AgeBand)) # get all age bands from the dataset_Plotting
      group <- as.character(unique(dataset_Plotting$Group))
      
      #create empty lists to pupulate with plots
      plots0 <-  list()
      plots1 <-  list()
      plots2 <-  list()
      plots3 <-  list()
      for (type in types){
        for (age in ages){
          #Forecast Individual Graphs
          split <- type
          y_axes_title <- "Number of cases"
          #Forecast Plot titles 
          if(grepl("type28", split[[1]][1])){
            title_short <- paste0(dataset_Name,": New daily deaths within 28 days of first positive specimen date")
          } else if(grepl("death", split[[1]][1])){
            title_short <- paste0(dataset_Name,": New daily deaths by date of death as per PHE line list of deaths")
          } else if (grepl("icu_prev", split[[1]][1])){
            title_short <- paste0(dataset_Name,": Occupied ICU beds")
          } else if (grepl("hospital_prev", split[[1]][1])){
            title_short <- paste0(dataset_Name,": Occupied hospital bed (includes ICU beds)")
          } else if (grepl("num_positive_tests", split[[1]][1])){
            title_short <- paste0(dataset_Name,": The number of positive tests")
          } else if (grepl("infections_cum", split[[1]][1])){
            title_short <- paste0(dataset_Name,": Cumulative number of infections of both symptomatic and asymptomatic")
          } else if (grepl("infections_inc", split[[1]][1])){
            title_short <- paste0(dataset_Name, ": Number of new daily infections, including both symptomatic and asymptomatic individuals")
          } else if (grepl("hospital_inc", split[[1]][1])){
            title_short <- paste0(dataset_Name,": New daily hospital admissions")
          } else if (grepl("prevalence_mtp", split[[1]][1])){
            title_short <- paste0(dataset_Name,": Prevalence")
            y_axes_title <- "Percentage"
          }
          
          # UK:
          graph_data <- dataset_Plotting %>% filter(Geography == "United Kingdom", ValueType == type, Value.Date <= max_window_date, Group == group, AgeBand == age)
          graph_data_cases <- subset(graph_data, IND == 0)
          graph_data_forecast <- subset(graph_data, IND == 1)
          
          if(nrow(graph_data_forecast) != 0){ #Only continue if we have forecast data
            
            graph_data_cases <- graph_data_cases %>% filter(Group %in% unique(graph_data_forecast$Group)) #Only keep cases data for groups which have forecast data
            graph_data_cases <- graph_data_cases %>% filter(Geography %in% unique(graph_data_forecast$Geography)) #Only keep countries which have forecasted data 
            min_date <- min(graph_data$Value.Date)
            max_date <- max(graph_data$Value.Date)
            current_date <- today
            min_num <- min(graph_data$Quantile.0.05)
            max_num <- max(graph_data$Quantile.0.95)
            
            #UK Plot only
            p0 <- ggplot(graph_data_forecast, aes(x=Value.Date, y=Value))+geom_path(aes(colour = Group),size=1)+
              geom_ribbon(aes(x = Value.Date,ymin=Quantile.0.05, ymax=Quantile.0.95, fill=Group), show.legend = FALSE, linetype=2, alpha=0.1, colour = NA)+
              geom_point(data=graph_data_cases, size=2.5, aes(shape = factor(DEATH_4DAY_IND)))+
              geom_vline(xintercept=as.numeric(as.Date(today)), linetype="dotted", size=1.2)+
              facet_wrap(~AgeBand+Geography, ncol = 2, scales = "free_y")+
              scale_x_date(date_labels = "%d-%b", breaks=as.Date(c(min_date, current_date, max_date)), limits=c(min_date, max_date))+
              scale_y_continuous(labels=comma, limits=c(min_num, max_num))+
              theme(axis.text.x=element_text(size=10), axis.text.y=element_text(size=10), axis.title.x=element_text(size=15), axis.title.y=element_text(size=15))+
              theme(panel.grid.major = element_blank(), panel.grid.minor = element_blank(),
                    panel.background = element_blank(), axis.line = element_line(colour = "black"),
                    panel.spacing.x = unit(8, "mm"))+
              scale_colour_manual(values = "black", name = "Forecast")+
              scale_fill_manual(values = "black")+
              scale_shape_manual(values = c(16,7), labels = c("data","data (expected to increase)"), name = "Cases")+
              labs(title = title_short, x = "Date", y = y_axes_title, subtitle = group)+
              guides(shape = guide_legend(order = 2),color = guide_legend(order = 1))
            plots0 <- c(plots0, list(p0))
            
          }
          
          # UK nations:
          graph_data <- dataset_Plotting %>% filter(Geography == "England" | Geography == "Scotland" | Geography == "Wales" | Geography == "Northern Ireland", ValueType == type, Value.Date <= max_window_date, Group == group, AgeBand == age)
          graph_data_cases <- subset(graph_data, IND == 0)
          graph_data_forecast <- subset(graph_data, IND == 1)
          
          if(nrow(graph_data_forecast) != 0){ #Only continue if we have forecast data
            
            graph_data_cases <- graph_data_cases %>% filter(Group %in% unique(graph_data_forecast$Group)) #Only keep cases data for groups which have forecast data
            graph_data_cases <- graph_data_cases %>% filter(Geography %in% unique(graph_data_forecast$Geography)) #Only keep countries which have forecasted data 
            min_date <- min(graph_data$Value.Date)
            max_date <- max(graph_data$Value.Date)
            current_date <- today
            min_num <- min(graph_data$Quantile.0.05)
            max_num <- max(graph_data$Quantile.0.95)
            
            #UK Plot with country facet wrapped
            p1 <- ggplot(graph_data_forecast, aes(x=Value.Date, y=Value))+geom_path(aes(colour = Group),size=1)+
              geom_ribbon(aes(x = Value.Date,ymin=Quantile.0.05, ymax=Quantile.0.95, fill=Group), show.legend = FALSE, linetype=2, alpha=0.1, colour = NA)+
              geom_point(data=graph_data_cases, size=2.5, aes(shape = factor(DEATH_4DAY_IND)))+
              geom_vline(xintercept=as.numeric(as.Date(today)), linetype="dotted", size=1.2)+
              facet_wrap(~AgeBand+Geography, ncol = 2, scales = "free_y")+
              scale_x_date(date_labels = "%d-%b", breaks=as.Date(c(min_date, current_date, max_date)), limits=c(min_date, max_date))+
              scale_y_continuous(labels=comma, limits=c(min_num, max_num))+
              theme(axis.text.x=element_text(size=10), axis.text.y=element_text(size=10), axis.title.x=element_text(size=15), axis.title.y=element_text(size=15))+
              theme(panel.grid.major = element_blank(), panel.grid.minor = element_blank(),
                    panel.background = element_blank(), axis.line = element_line(colour = "black"),
                    panel.spacing.x = unit(8, "mm"))+
              scale_colour_manual(values = "black", name = "Forecast")+
              scale_fill_manual(values = "black")+
              scale_shape_manual(values = c(16,7), labels = c("data","data (expected to increase)"), name = "Cases")+
              labs(title = title_short, x = "Date", y = y_axes_title, subtitle = group)+
              guides(shape = guide_legend(order = 2),color = guide_legend(order = 1))
            plots1 <- c(plots1, list(p1))
            
          }
          
          #Region Plots with region facet wrapped
          graph_data <- subset(dataset_Plotting, ValueType == type & (Geography == "London" | Geography == "East of England" | Geography == "Midlands" | Geography == "North East and Yorkshire" | Geography == "North West" | Geography == "South East" | Geography == "South West")
                               & Value.Date <= max_window_date & Group == group & AgeBand == age)
          graph_data_cases <- subset(graph_data, IND == 0)
          graph_data_forecast <- subset(graph_data, IND == 1)
          
          if(nrow(graph_data_forecast) != 0){
            
            graph_data_cases <- graph_data_cases %>% filter(Group %in% unique(graph_data_forecast$Group))
            graph_data_cases <- graph_data_cases %>% filter(Geography %in% unique(graph_data_forecast$Geography))
            
            min_date <- min(graph_data$Value.Date)
            max_date <- max(graph_data$Value.Date)
            current_date <- today
            min_num <- min(graph_data$Quantile.0.05)
            max_num <- max(graph_data$Quantile.0.95)
            
            p2 <-  ggplot(graph_data_forecast, aes(x=Value.Date, y=Value))+geom_path(aes(colour = Group),size=1)+
              geom_ribbon(aes(x = Value.Date,ymin=Quantile.0.05, ymax=Quantile.0.95, fill=Group), show.legend = FALSE, linetype=2, alpha=0.1, colour = NA)+
              geom_point(data=graph_data_cases, size=1.5, aes(shape = factor(DEATH_4DAY_IND)))+
              geom_vline(xintercept=as.numeric(as.Date(today)), linetype="dotted", size=0.8)+
              facet_wrap(~AgeBand+Geography, scales = "free_y")+
              scale_x_date(date_labels = "%d-%b", breaks=as.Date(c(min_date, current_date, max_date)), limits=c(min_date, max_date))+
              scale_y_continuous(labels=comma, limits=c(min_num, max_num))+
              theme(axis.text.x=element_text(size=8), axis.text.y=element_text(size=10), axis.title.x=element_text(size=15), axis.title.y=element_text(size=15))+
              theme(panel.grid.major = element_blank(), panel.grid.minor = element_blank(),
                    panel.background = element_blank(), axis.line = element_line(colour = "black"),
                    panel.spacing.x = unit(8, "mm"), strip.text.x = element_text(size = 10))+
              scale_colour_manual(values = "black", name = "Forecast")+
              scale_fill_manual(values = "black")+
              scale_shape_manual(values = c(16,7), labels = c("data","data (expected to increase)"), name = "Cases")+
              labs(title = title_short, x = "Date", y = y_axes_title, subtitle = group)+
              guides(shape = guide_legend(order = 2),color = guide_legend(order = 1))
            plots2 <- c(plots2, list(p2))
            
          }
          
          #Region Plots with sub-region facet wrapped
          graph_data <- subset(dataset_Plotting, ValueType == type & Geography != "United Kingdom" & Geography != "England" & Geography != "Scotland" & Geography != "Wales" & Geography != "Northern Ireland" & Geography != "London" & Geography != "East of England" & Geography != "Midlands" & Geography != "North East and Yorkshire" & Geography != "North West" & Geography != "South East" & Geography != "South West"
                               & Value.Date <= max_window_date & Group == group & AgeBand == age)
          graph_data_cases <- subset(graph_data, IND == 0)
          graph_data_forecast <- subset(graph_data, IND == 1)
          
          if(nrow(graph_data_forecast) == 0){
            next
          }
          
          graph_data_cases <- graph_data_cases %>% filter(Group %in% unique(graph_data_forecast$Group))
          graph_data_cases <- graph_data_cases %>% filter(Geography %in% unique(graph_data_forecast$Geography))
          
          min_date <- min(graph_data$Value.Date)
          max_date <- max(graph_data$Value.Date)
          current_date <- today
          min_num <- min(graph_data$Quantile.0.05)
          max_num <- max(graph_data$Quantile.0.95)
          
          p3 <-  ggplot(graph_data_forecast, aes(x=Value.Date, y=Value))+geom_path(aes(colour = Group),size=1)+
            geom_ribbon(aes(x = Value.Date,ymin=Quantile.0.05, ymax=Quantile.0.95, fill=Group), show.legend = FALSE, linetype=2, alpha=0.1, colour = NA)+
            geom_point(data=graph_data_cases, size=1.5, aes(shape = factor(DEATH_4DAY_IND)))+
            geom_vline(xintercept=as.numeric(as.Date(today)), linetype="dotted", size=0.8)+
            facet_wrap(~AgeBand+Geography, scales = "free_y")+
            scale_x_date(date_labels = "%d-%b", breaks=as.Date(c(min_date, current_date, max_date)), limits=c(min_date, max_date))+
            scale_y_continuous(labels=comma, limits=c(min_num, max_num))+
            theme(axis.text.x=element_text(size=8), axis.text.y=element_text(size=10), axis.title.x=element_text(size=15), axis.title.y=element_text(size=15))+
            theme(panel.grid.major = element_blank(), panel.grid.minor = element_blank(),
                  panel.background = element_blank(), axis.line = element_line(colour = "black"),
                  panel.spacing.x = unit(8, "mm"), strip.text.x = element_text(size = 10))+
            scale_colour_manual(values = "black", name = "Forecast")+
            scale_fill_manual(values = "black")+
            scale_shape_manual(values = c(16,7), labels = c("data","data (expected to increase)"), name = "Cases")+
            labs(title = title_short, x = "Date", y = y_axes_title, subtitle = group)+
            guides(shape = guide_legend(order = 2),color = guide_legend(order = 1))
          plots3 <- c(plots3, list(p3))
          
          
        }
      }
      if (group == "Manchester/Oxford"){
        group <- "Manchester_Oxford"
      }
      if (group == "Imperial: Combined"){
        group <- "Imperial"
      }

      
      # then the plots
      if(length(plots0) >=1){
        for (i in seq(length(plots0))) {
          print(plots0[[i]])
        }
      }
      
      if(length(plots1) >=1){
        for (i in seq(length(plots1))) {
          print(plots1[[i]])
        }
      }
      
      if(length(plots2) >=1){
        for (i in seq(length(plots2))) {
          print(plots2[[i]])
        }
      }
      
      if(length(plots3) >=1){
        for (i in seq(length(plots3))) {
          print(plots3[[i]])
        }
      }
    }
  }
  
  dev.off()
}

#######################
# Data set up
#######################

#******************#
# Case data
#******************#
print(paste("DEBUG:  ", WORKING_DIR))
case_file_list <- list.files(path=paste0(WORKING_DIR, "/Case data/"), pattern="*.xlsx", full.names = TRUE, recursive = FALSE)
# Remove any open files from the list:
case_file_list <- case_file_list[!grepl("~", case_file_list)]
case_file <- case_file_list[1]

print(paste("DEBUG:  case file: ", case_file))

# Updated Cases data:
cases_data <- read_xlsx(case_file, sheet="Extracted Data", guess_max = 21474836)
options(warn=-1) #suppresses uninitialised column warning
cases_data$Value.Date <- 0
for (i in 1:nrow(cases_data)){
  cases_data$Value.Date[i] = paste(cases_data$Day[i], cases_data$Month[i], cases_data$Year[i], sep = "/")
}
cases_data <- cases_data %>% select(-Day, -Month, -Year)
# Value Date:
cases_data$Value.Date <- as.Date(as.character(cases_data$Value.Date), "%d/%m/%Y")
# Keep only data from min window:
cases_data <- cases_data %>% filter(Value.Date >= min_window_date, Value.Date <= (today - 1))
options(warn=0) #unsuppresses warnings

# Keep only Nation and Region data:
cases_data <- cases_data %>% filter(ReportLevel == "Region" | ReportLevel == "National")

# Rename Daily_cases_positive variable:
names(cases_data)[names(cases_data) == "Daily_cases_positive"] <- "num_positive_tests"

# Keep only relevant columns
cases_data <- cases_data %>% select(ends_with("<1"), ends_with("1-4"), ends_with("5-14"), 
                                    ends_with("15-24"), ends_with("25-44"), ends_with("45-54"), 
                                    ends_with("55-64"), ends_with("65-74"), ends_with("75-84"), 
                                    ends_with(">84"), ends_with("85+"), Geography, Value.Date, 
                                    ends_with("hospital_inc"), ends_with("icu_prev"), 
                                    ends_with("hospital_prev"), ends_with("hospital_prev_<28days"), ends_with("type28_death_inc_line"), 
                                    ends_with("num_positive_tests"))

#Organise death data:
cases_data <- cases_data %>% select(-starts_with("type60"))
cases_data <- cases_data %>% select(-starts_with("confirmed_death_inc_line"))

# Replace Scotland's hospital prev data:
for(i in 1:nrow(cases_data)){
  if(cases_data$Geography[i] == "Scotland"){
    cases_data[i, "hospital_prev"] <- cases_data[i, "hospital_prev_<28days"]
  }
}
cases_data <- cases_data %>% select(-"hospital_prev_<28days")

#Transpose and filter:
cases_data2 <- cases_data %>% 
  melt(id = c("Geography", "Value.Date")) %>% 
  rename(Value = value) 

# Create ageband:
for(i in 1:nrow(cases_data2)){
  if(grepl("infections_inc", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "infections_inc"
    cases_data2$AgeBand[i] <- gsub("infections_inc", "", cases_data2$variable[i])
  } else if (grepl("hospital_inc", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "hospital_inc"
    cases_data2$AgeBand[i] <- gsub("hospital_inc", "", cases_data2$variable[i])
  } else if (grepl("icu_prev", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "icu_prev"
    cases_data2$AgeBand[i] <- gsub("icu_prev", "", cases_data2$variable[i])
  } else if (grepl("hospital_prev", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "hospital_prev"
    cases_data2$AgeBand[i] <- gsub("hospital_prev", "", cases_data2$variable[i])
  } else if (grepl("type28_death_inc_line", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "type28_death_inc_line"
    cases_data2$AgeBand[i] <- gsub("type28_death_inc_line", "", cases_data2$variable[i])
  } else if (grepl("death_inc_line", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "death_inc_line"
    cases_data2$AgeBand[i] <- gsub("death_inc_line", "", cases_data2$variable[i])
  } else if (grepl("icu_inc", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "icu_inc"
    cases_data2$AgeBand[i] <- gsub("icu_inc", "", cases_data2$variable[i])
  } else if (grepl("prevalence", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "prevalence"
    cases_data2$AgeBand[i] <- gsub("prevalence", "", cases_data2$variable[i])
  } else if (grepl("num_positive_tests", cases_data2$variable[i])){
    cases_data2$ValueType[i] <- "num_positive_tests"
    cases_data2$AgeBand[i] <- gsub("num_positive_tests", "", cases_data2$variable[i])
  }
}
cases_data2$ValueType <- as.character(cases_data2$ValueType)

for(i in 1:nrow(cases_data2)){
  if(cases_data2$AgeBand[i] == ""){
    cases_data2$AgeBand[i] <- "All"
  } else if(cases_data2$AgeBand[i] == "_85+"){
      cases_data2$AgeBand[i] <- "85+"
  } else if(cases_data2$AgeBand[i] == ">84"){
    cases_data2$AgeBand[i] <- "85+"
  }
}
cases_data2$AgeBand <- as.character(cases_data2$AgeBand)

cases_data2 <- cases_data2 %>% select(-variable)

#******************#
#Forecast data
#******************#

forecastFile <- paste0(WORKING_DIR, "/Forecast data/", OUTPUT_FILENAME)

#Determine if sv or xlsx:
if (grepl(".csv", forecastFile, fixed = TRUE)) {

  print(paste("DEBUG:  csv file: ", forecastFile))
  data <- read.csv(forecastFile, header = TRUE, sep=",")

} else if (grepl( ".xlsx",forecastFile, fixed = TRUE)) {
  print(paste("DEBUG:  xlsx file: ", forecastFile))

  #Create temp data:   
  n <- length(getSheetNames(forecastFile))
  data <- read_xlsx(forecastFile, sheet=n)
  data <- as.data.frame(data)
  data <- data %>% rename_all(function(x) gsub(" ", ".", x))

}

# Remove unrequired value types:
data$ValueType <- as.character(data$ValueType)
data <- data %>% filter(ValueType %in% desired_types)

# Filter dates:
data$Day.of.Value <- as.numeric(data$Day.of.Value)
data$Month.of.Value <- as.numeric(data$Month.of.Value)
data$Year.of.Value <- as.numeric(data$Year.of.Value)
data <- data %>% mutate(Value.Date = make_datetime(Year.of.Value, Month.of.Value, Day.of.Value))
# Filter out any historical data:
data <- data %>% filter(Value.Date > today - 1 | ValueType %in% metrics_of_interest_x)
# Filter out redundent variables:
data <- data %>% select(-starts_with("Creation"), -ends_with("of.Value"), -ends_with("Day"), -ends_with("Month"), -ends_with("Year"), -starts_with("Day"), -starts_with("Month"), -starts_with("Year"), -ends_with("X"))

# Update AgeBand if empty:  
if(!"AgeBand" %in% colnames(data)){
  data$AgeBand <- "All"
}
# Determine if Age = All only in data:
if(length(unique(as.character(data$AgeBand))) == 1 & data$AgeBand[1] == "All"){
  cases_data2 <- cases_data2 %>% filter(AgeBand == "All")  
}

# Replace infinite values with NA:
data <- do.call(data.frame,lapply(data, function(x) replace(x, is.infinite(x),NA)))

#Ensure value columns are numeric:
varlist <- c("Value", "Quantile.0.05", "Quantile.0.1", "Quantile.0.15", "Quantile.0.2", "Quantile.0.25", "Quantile.0.3", "Quantile.0.35", "Quantile.0.4", "Quantile.0.45", "Quantile.0.5", "Quantile.0.55", "Quantile.0.6", "Quantile.0.65", "Quantile.0.7", "Quantile.0.75", "Quantile.0.8", "Quantile.0.85", "Quantile.0.9", "Quantile.0.95")
for(j in varlist){
  if(j %in% colnames(data)){
    data[,j] <- as.numeric(data[,j])
  }
}
data$Value <- data$Quantile.0.5

#Age 5-14 change from date to character:
data$AgeBand <- as.character(data$AgeBand)
data$AgeBand[data$AgeBand=="41760"] <- "5-14"
data$AgeBand[data$AgeBand=="May-14"] <- "5-14"

if("incidence_prev" %in% data$ValueType){
  submitted_prevalence_oldname_nowcast<-TRUE
  data$ValueType[data$ValueType=="incidence_prev"]<-"prevalence"
}else{submitted_prevalence_oldname_nowcast<-FALSE}

if("infections_prev" %in% data$ValueType){
  submitted_prevalence_oldname_MTP<-TRUE
  data$ValueType[data$ValueType=="infections_prev"]<-"prevalence_mtp"
}else{submitted_prevalence_oldname_MTP<-FALSE}

#Geography
data$Geography <- as.character(data$Geography)
data$Geography[data$Geography=="ENGLAND"] <- "England"
data$Geography[data$Geography=="Yorkshire"] <- "Yorkshire and Humber"
data$Geography[data$Geography=="Yorkshire and the Humber"] <- "Yorkshire and Humber"
data$Geography[data$Geography=="UK"] <- "United Kingdom"
data <- data %>% filter(Geography != "England: Unknown")

#Version
data$Version <- as.character(data$Version)

#Model
data$Model <- as.character(data$Model)

#Make Unique Groups:
data$Group <- as.character(data$Group)

#Make distinct groups:
data$Group <- paste0(data$Group, ": ", data$Model)

# Clean scenario text:
data$Scenario <- sub("/", "_", data$Scenario)

# Create back-up of complete data set before model loop through:
data_original <- data
model_levels <- unique(as.vector(data_original$Model))

for (model_level in model_levels){
  
  model_level_trim <- paste0("_", gsub("/", "", model_level))
  if(length(model_levels) == 1){
    model_level_trim <- ""
  }                             
  data <- data_original %>% filter(Model == model_level)
  data$Group <- as.factor(data$Group) # (As Group incorporates Model too)
  
  #******************#
  #******************#
  #Create a summary table before any further data manipulation goes on
  #******************#
  #******************#
  data_nowcast_mtp<-data[data$Scenario %in% c("Nowcast","ONS", "MTP") ,]
  data_other_scenarios<-data[data$Scenario %in% c("Nowcast", "ONS", "MTP") == FALSE,]
  other_scenarios_list<-unique(as.vector(data_other_scenarios$Scenario))
  if(sum(is.na(other_scenarios_list))>0){other_scenarios_list<-other_scenarios_list[-which(is.na(other_scenarios_list))]}
  
  #******************#
  #******************#
  #Create a summary table before any further data manipulation goes on
  #******************#
  #******************#
  
  geogs<-c("United Kingdom",
           "England",
           "Wales",
           "Scotland",
           "Northern Ireland",
           "London",
           "East of England",
           "Midlands",
           "North East and Yorkshire",
           "North West",
           "South West",
           "West Midlands",
           "East Midlands",
           "North East",
           "Yorkshire and Humber")  
  
  summary_table<-data.frame(matrix(ncol=length(metrics_of_interest_x)+length(metrics_of_interest_time), nrow=length(geogs)))
  names(summary_table)<-c(metrics_of_interest_x,metrics_of_interest_time)
  rownames(summary_table)<-geogs
  
  for (geog in 1:length(geogs)){
    if(sum(as.vector(data_nowcast_mtp$Geography)==geogs[geog])>0){
      data_geog<-data_nowcast_mtp[data_nowcast_mtp$Geography==geogs[geog],]
      for (metric in 1:length(metrics_of_interest_x)){
        if(metrics_of_interest_x[metric] %in% as.vector(data_geog$ValueType)){value_present<-"X"}else{value_present<-""}
        summary_table[geog,metric]<-value_present
      }
      for (metric in 1:length(metrics_of_interest_time)){
        if(metrics_of_interest_time[metric] %in% as.vector(data_geog$ValueType)){
          max_date<-max(data_geog$Value.Date[data_geog$ValueType==metrics_of_interest_time[metric]])
          num_weeks<-floor(as.numeric(difftime(max_date, tomorrow))/7)
          remainder_days<-as.numeric(difftime(max_date, tomorrow)) %% 7
          if(num_weeks>0){
            value_present<-paste0(num_weeks, " weeks ", remainder_days, " days *")
          }else{value_present<-""}
          
        }else{value_present<-""}
        summary_table[geog,(metric+length(metrics_of_interest_x))]<-value_present
      }
    }
    if(sum(data_nowcast_mtp$Geography==geogs[geog])==0){
      summary_table[geog,]<-t(rep("", ncol(summary_table)))
    }
  }
  
  mytheme <- gridExtra::ttheme_default(
    core = list(fg_params=list(cex = 1.0)),
    colhead = list(fg_params=list(cex = 0.5)),
    rowhead = list(fg_params=list(cex =0.5)))
  
  summary_table_grob<-tableGrob(summary_table, theme = mytheme)
  
  title <- textGrob(paste0(OUTPUT_FILENAME,"\nGroup: ", data$Group[1], "\nNowcast and MTP data submitted:"),gp=gpar(fontsize=15),x=0, hjust=0)
  
  footnote_text<- paste0("* weeks/days given from: ",tomorrow )
  
  if(submitted_prevalence_oldname_nowcast){
    footnote_text<-paste0(footnote_text, "\nNowcast Prevalence submitted with old name (incidence_prev)")
  }
  if(submitted_prevalence_oldname_MTP){
    footnote_text<-paste0(footnote_text, "\nMTP Prevalence submitted with old name (infections_prev)")
  }
  
  footnote <- textGrob(footnote_text, x=0, hjust=0,
                        gp=gpar( fontface="italic"))
  
  
  padding <- unit(0.5,"line")
  summary_table_grob <- gtable_add_rows(summary_table_grob, 
                                        heights = grobHeight(title) + padding,
                                        pos = 0)
  summary_table_grob <- gtable_add_rows(summary_table_grob, 
                                        heights = grobHeight(footnote)+ padding)
  summary_table_grob <- gtable_add_grob(summary_table_grob, list(title, footnote),
                                        t=c(1, nrow(summary_table_grob)), l=c(1,2), 
                                        r=ncol(summary_table_grob))
  
  if (length(other_scenarios_list)>0){
    for(scenario in other_scenarios_list){
      summary_table_scenario<-data.frame(matrix(ncol=length(metrics_of_interest_time), nrow=length(geogs)))
      names(summary_table_scenario)<-c(metrics_of_interest_time)
      rownames(summary_table_scenario)<-geogs
      
      data_Scenario<-data_other_scenarios[data_other_scenarios$Scenario==scenario,]
      if(sum(is.na(data_Scenario$Geography))>0){
        data_Scenario<- data_Scenario[-which(is.na(data_Scenario$Geography)),]
      }
      
      for (geog in 1:length(geogs)){
        if(sum(as.vector(data_Scenario$Geography)==geogs[geog])>0){
          data_geog<-data_Scenario[data_Scenario$Geography==geogs[geog],]
          for (metric in 1:length(metrics_of_interest_time)){
            if(metrics_of_interest_time[metric] %in% as.vector(data_geog$ValueType)){
              max_date<-max(data_geog$Value.Date[data_geog$ValueType==metrics_of_interest_time[metric]])
              num_weeks<-floor(as.numeric(difftime(max_date, tomorrow))/7)
              remainder_days<-as.numeric(difftime(max_date, tomorrow)) %% 7
              if(num_weeks>0){
                value_present<-paste0(num_weeks, " weeks ", remainder_days, " days *")
              }else{value_present<-""}
              
            }else{value_present<-""}
            summary_table_scenario[geog,(metric)]<-value_present
          }
        }
        if(sum(data_Scenario$Geography==geogs[geog])==0){
          summary_table_scenario[geog,]<-t(rep("", ncol(summary_table_scenario)))
        }
      }
      
      mytheme <- gridExtra::ttheme_default(
        core = list(fg_params=list(cex = 1.0)),
        colhead = list(fg_params=list(cex = 0.5)),
        rowhead = list(fg_params=list(cex =0.5)))
      
      summary_table_scenario_grob<-tableGrob(summary_table_scenario, theme = mytheme)
      
      title <- textGrob(paste0(scenario, " data submitted:"),gp=gpar(fontsize=15),x=0, hjust=0)
      
      footnote_text<- paste0("* weeks/days given from beginning of projection window: ",tomorrow )
      
      footnote <- textGrob(footnote_text, x=0, hjust=0,
                           gp=gpar( fontface="italic"))
      
      
      padding <- unit(0.5,"line")
      summary_table_scenario_grob <- gtable_add_rows(summary_table_scenario_grob, 
                                            heights = grobHeight(title) + padding,
                                            pos = 0)
      summary_table_scenario_grob <- gtable_add_rows(summary_table_scenario_grob, 
                                            heights = grobHeight(footnote)+ padding)
      summary_table_scenario_grob <- gtable_add_grob(summary_table_scenario_grob, list(title, footnote),
                                            t=c(1, nrow(summary_table_scenario_grob)), l=c(1,2), 
                                            r=ncol(summary_table_scenario_grob))
      
      assign(paste0(scenario,"summary_table"),summary_table_scenario_grob)
    }
  }
  
  #******************#
  #******************#
  #Merge historical case data in:
  #******************#
  #******************#
  #Keep only forecast data from download date onwards
  data_clean <- data %>% filter(Value.Date > today-1)
  
  for(v_types in metrics_of_interest_x){
    data_clean <- data_clean %>% filter(ValueType != v_types)  
  }
  
  # PRINT the summary table if the data_clean has no forwards data
  if(nrow(data_clean)==0){
    outputNameWithoutExtension <- tools::file_path_sans_ext(OUTPUT_FILENAME)
    
    path <- gsub(" ", "_",paste0(outputNameWithoutExtension, model_level_trim, ".pdf"))
    pdfFile <- paste0(WORKING_DIR, "/", path)
    print(paste("DEBUG:  plotting: ", pdfFile))
    
    pdf(pdfFile, onefile = TRUE, width=11, height=7.6)
    
    # summary table first
    print(grid.draw(summary_table_grob))
    
    dev.off()
  }
  
  # Otherwise, continue as usual
  if(nrow(data_clean)>0){
    
    data_clean <- add_historical_data(data_clean, cases_data2)
    data_clean <- data_clean %>% 
      rename(Value = Value.x)
    
    for(i in 1:nrow(data_clean)){
      if (!is.na(data_clean$Value.y[i])){
        data_clean$Value[i] <- data_clean$Value.y[i]
      }
    }
    
    data_clean <- data_clean %>% select(-Value.y)
    
    #Only keep historical data upto 28 days before download date 
    data_clean <- data_clean %>% filter(Value.Date >= min_window_date)
    
    #Remove NA rows:
    data_clean <- remove_na(data_clean, "Value")
    data_clean <- data_clean %>% filter(Geography != "England: Unknown")
    
    #Change all relevant variables to factors:
    data_clean$Model <- factor(data_clean$Model)
    data_clean$Group <- factor(data_clean$Group)
    age_levels <- c("All", "0-4", "5-14", "15-24", "25-44", "45-64", "65-74", "75+")
    data_clean$AgeBand <- factor(data_clean$AgeBand, levels = age_levels)
    data_clean$ValueType <- factor(data_clean$ValueType, levels = desired_types)
    region_levels <- c("United Kingdom", "England", "Wales", "Scotland", "Northern Ireland", "London", "East of England", "Midlands", "North East and Yorkshire", "North West", "South East", "South West", "West Midlands", "East Midlands", "North East", "Yorkshire and Humber")
    region_levels_all <- unique(data_clean$Geography)
    region_levels_all <- c(region_levels,region_levels_all)
    region_levels_all <- unique(region_levels_all)
    data_clean$Geography <- factor(data_clean$Geography, levels = region_levels_all)
    data_clean$Value <- as.numeric(data_clean$Value)
    
    temp <-  as.data.frame(data_clean %>% select(starts_with("Q")) %>% sapply(as.numeric))
    temp2 <-  as.data.frame(data_clean %>% select(-starts_with("Q")))
    
    data_clean <- cbind(temp, temp2)
    
    #data cut-off point indicator (using system date):
    data_clean$IND <- 0
    data_clean$IND[data_clean$Value.Date > (today-1)] <- 1
    
    #data indicator for last 4 days (death_inc_line data and hospitl_inc data for Wales and Scotland):
    data_clean <- add_4day_indicator(data_clean)
    
    data_clean$Group <- factor(data_clean$Group)
    
    data_clean <- data_clean %>% filter(ValueType != "hospital_inc_new")
    data_clean <- data_clean[order(data_clean$AgeBand, data_clean$ValueType),] #sort data by value type
    
    summary_table_list<-ls()[grepl("summary_table", ls())]
    summary_table_list<-summary_table_list[-which(summary_table_list %in% c("summary_table_grob" ,"summary_table_scenario","summary_table","summary_table_scenario_grob","summary_table_list"))]
    summary_table_list<-c("summary_table_grob"  , summary_table_list)
  
    data_clean$Value.Date <- as.Date(data_clean$Value.Date)
    
    if(length(other_scenarios_list) > 0){
      for (scenario in other_scenarios_list){
        data_Scenario<-data_clean[data_clean$Scenario==scenario,]
        if(sum(is.na(data_Scenario$Geography))>0){
          data_Scenario<- data_Scenario[-which(is.na(data_Scenario$Geography)),]
        }
        
        assign(paste0("data_clean_", scenario), data_Scenario)
      }
      
      # Remove Nowcast:
      data_clean<-data_clean[data_clean$Scenario %in% "MTP",]
      
      datasets<-ls()[grepl("data_clean", ls())]
      datasets<-datasets[-which(datasets %in% c("data_clean"))]
      datasets<-c("data_clean"  , datasets)
      
    } else {
      datasets <- "data_clean"
    }
    
    plot2(datasets = datasets, summary_table_list= summary_table_list)
  }

}